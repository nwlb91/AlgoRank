"""start.gg ingestion orchestration.

Backfill:
  1. Seed date windows from BACKFILL_START to now and walk them, discovering
     every tournament with a Melee event (windows split adaptively to stay
     under the API's 10,000-result pagination cap).
  2. Process every discovered event: phases, groups, entrants (with full
     player/user info), seeds, sets (with slots, games, characters, stages,
     per-game scores), standings.

Incremental:
  Re-discover a sliding window (overlap_days back, horizon_days forward),
  re-process events that are new, updated, or not yet final.

All progress lives in the database (discovery_window, event.ingest_status,
kv_state), so runs can be interrupted and resumed at any time — including
running as time-boxed CI jobs.
"""

from __future__ import annotations

import logging
from datetime import timedelta

import psycopg

from .. import db
from ..config import Config
from ..util import Deadline, month_windows, parse_date, utcnow
from . import normalize as nz
from . import queries
from .client import ComplexityError, FatalQueryError, PageSizer, StartGGClient

log = logging.getLogger("algorank.startgg")

SOURCE = "startgg"
PAGINATION_CAP = 10_000


class StartGGIngest:
    def __init__(self, cfg: Config, conn: psycopg.Connection):
        self.cfg = cfg
        self.conn = conn
        self.client = StartGGClient(
            cfg.startgg_url,
            cfg.startgg_token,
            rpm=cfg.startgg_rpm,
            timeout=cfg.http_timeout,
            on_fallback=self._record_fallback,
        )
        self.specs = {
            "window": queries.tournaments_window(),
            "event_detail": queries.event_detail(),
            "sets": queries.event_sets_page(),
            "pg_sets": queries.phase_group_sets_page(),
            "entrants": queries.event_entrants_page(),
            "standings": queries.event_standings_page(),
            "seeds": queries.phase_seeds_page(),
            "videogame": queries.videogame_check(),
        }
        for fb in db.load_field_fallbacks(conn, SOURCE):
            for spec in self.specs.values():
                self.client.apply_known_fallbacks(spec, [fb])
        self.sizers = {
            "window": PageSizer(cfg.per_page_discovery),
            "sets": PageSizer(cfg.per_page_sets),
            "entrants": PageSizer(cfg.per_page_entrants),
            "standings": PageSizer(cfg.per_page_standings),
            "seeds": PageSizer(cfg.per_page_seeds),
            "phase_groups": PageSizer(cfg.per_page_phase_groups),
        }
        self.character_map: dict[str, int] = {}
        self.stage_map: dict[str, int] = {}
        self.videogame_internal_id: int | None = None

    # ------------------------------------------------------------------
    # bookkeeping
    # ------------------------------------------------------------------

    def _record_fallback(self, query_name: str, kind: str, name: str, message: str) -> None:
        db.record_field_fallback(self.conn, SOURCE, query_name, kind, name, message)

    def snapshot_schema(self) -> None:
        """Store an introspection snapshot so we always know what the API offered."""
        try:
            payload = self.client._post(queries.INTROSPECTION_QUERY, {})
            if payload.get("data"):
                db.save_schema_snapshot(self.conn, SOURCE, "introspection", payload["data"])
                log.info("stored start.gg schema snapshot")
        except Exception as exc:  # non-fatal by design
            log.warning("schema introspection failed (non-fatal): %s", exc)

    def sync_videogame(self) -> None:
        """Verify the Melee videogame id and load character/stage reference data."""
        data = self.client.execute(self.specs["videogame"], {"videogameId": self.cfg.melee_videogame_id})
        vg = data.get("videogame")
        if not vg:
            raise FatalQueryError(f"videogame id {self.cfg.melee_videogame_id} not found")
        name = (vg.get("name") or "") + " " + (vg.get("displayName") or "")
        if "melee" not in name.lower():
            raise FatalQueryError(
                f"videogame id {self.cfg.melee_videogame_id} is {name!r}, not Melee — refusing to ingest"
            )
        self.videogame_internal_id = db.upsert(
            self.conn,
            "videogame",
            {
                "source": SOURCE,
                "external_id": str(vg["id"]),
                "name": vg.get("name"),
                "display_name": vg.get("displayName"),
                "slug": vg.get("slug"),
                "raw": {k: v for k, v in vg.items() if k not in ("characters", "stages")},
                "last_ingested_at": utcnow(),
            },
        )
        for ch in vg.get("characters") or []:
            cid = db.upsert(
                self.conn,
                "game_character",
                {
                    "source": SOURCE,
                    "external_id": str(ch["id"]),
                    "videogame_id": self.videogame_internal_id,
                    "name": ch.get("name"),
                    "raw": ch,
                    "last_ingested_at": utcnow(),
                },
            )
            self.character_map[str(ch["id"])] = cid
        for st in vg.get("stages") or []:
            sid = db.upsert(
                self.conn,
                "stage",
                {
                    "source": SOURCE,
                    "external_id": str(st["id"]),
                    "videogame_id": self.videogame_internal_id,
                    "name": st.get("name"),
                    "raw": st,
                    "last_ingested_at": utcnow(),
                },
            )
            self.stage_map[str(st["id"])] = sid
        self.conn.commit()
        log.info(
            "videogame ok: %s (%d characters, %d stages)",
            vg.get("name"), len(self.character_map), len(self.stage_map),
        )

    # ------------------------------------------------------------------
    # discovery
    # ------------------------------------------------------------------

    def seed_windows(self, start, end) -> int:
        created = 0
        with self.conn.cursor() as cur:
            for ws, we in month_windows(start, end):
                cur.execute(
                    """
                    INSERT INTO discovery_window (source, window_start, window_end)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (source, window_start, window_end) DO NOTHING
                    """,
                    (SOURCE, ws, we),
                )
                created += cur.rowcount
        self.conn.commit()
        return created

    def _next_window(self):
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM discovery_window
                WHERE source = %s AND status IN ('pending','in_progress','error')
                ORDER BY window_start
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """,
                (SOURCE,),
            )
            win = cur.fetchone()
            if win:
                cur.execute(
                    "UPDATE discovery_window SET status = 'in_progress', updated_at = now() WHERE id = %s",
                    (win["id"],),
                )
        self.conn.commit()
        return win

    def _split_window(self, win) -> None:
        mid = win["window_start"] + (win["window_end"] - win["window_start"]) / 2
        with self.conn.cursor() as cur:
            for ws, we in ((win["window_start"], mid), (mid, win["window_end"])):
                cur.execute(
                    """
                    INSERT INTO discovery_window (source, window_start, window_end)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (source, window_start, window_end) DO NOTHING
                    """,
                    (SOURCE, ws, we),
                )
            cur.execute(
                "UPDATE discovery_window SET status = 'split', updated_at = now() WHERE id = %s",
                (win["id"],),
            )
        self.conn.commit()
        log.info("split window %s — %s", win["window_start"], win["window_end"])

    def process_windows(self, deadline: Deadline) -> bool:
        """Returns True when no windows remain."""
        while not deadline.exceeded():
            win = self._next_window()
            if win is None:
                return True
            try:
                self._process_window(win)
            except Exception as exc:
                log.exception("window %s failed", win["id"])
                with self.conn.cursor() as cur:
                    cur.execute(
                        "UPDATE discovery_window SET status = 'error', error = %s, updated_at = now() WHERE id = %s",
                        (str(exc)[:1000], win["id"]),
                    )
                self.conn.commit()
                raise
        return False

    def _process_window(self, win) -> None:
        sizer = self.sizers["window"]
        spec = self.specs["window"]
        after = int(win["window_start"].timestamp())
        before = int(win["window_end"].timestamp())
        window_hours = (win["window_end"] - win["window_start"]).total_seconds() / 3600
        page, total, found = 1, None, 0
        while True:
            variables = {
                "page": page,
                "perPage": sizer.current,
                "videogameId": self.cfg.melee_videogame_id,
                "afterDate": after,
                "beforeDate": before,
            }
            try:
                data = self.client.execute(spec, variables)
            except ComplexityError:
                sizer.shrink()
                log.warning("discovery complexity error; perPage now %d, restarting window", sizer.current)
                page, found = 1, 0
                continue
            sizer.success()
            conn_data = data.get("tournaments") or {}
            if total is None:
                total = (conn_data.get("pageInfo") or {}).get("total") or 0
                if total > self.cfg.window_split_threshold and window_hours > self.cfg.min_window_hours:
                    self._split_window(win)
                    return
                if total > PAGINATION_CAP:
                    log.warning(
                        "window %s—%s has %d tournaments (> %d cap), data past the cap will be "
                        "picked up by smaller windows",
                        win["window_start"], win["window_end"], total, PAGINATION_CAP,
                    )
            nodes = conn_data.get("nodes") or []
            for node in nodes:
                if node:
                    self._upsert_discovered_tournament(node)
                    found += 1
            self.conn.commit()
            if not nodes or page * sizer.current >= min(total or 0, PAGINATION_CAP):
                break
            page += 1
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE discovery_window SET status = 'done', total_found = %s, updated_at = now() WHERE id = %s",
                (found, win["id"]),
            )
        self.conn.commit()
        log.info("window %s — %s: %d tournaments", win["window_start"].date(), win["window_end"].date(), found)

    def _upsert_discovered_tournament(self, node: dict) -> None:
        trow = nz.tournament_row(node)
        trow["ingest_status"] = "complete"  # tournament metadata is complete at discovery
        tid = db.upsert(self.conn, "tournament", trow)
        for srow in nz.stream_rows(node, tid):
            db.upsert(self.conn, "stream", srow)
        melee_id = str(self.cfg.melee_videogame_id)
        for ev in node.get("events") or []:
            if not ev:
                continue
            vg = (ev.get("videogame") or {}).get("id")
            if vg is not None and str(vg) != melee_id:
                continue  # defense in depth: server-side filter should already do this
            erow = nz.event_row(ev, tid, self.videogame_internal_id)
            eid = db.upsert(self.conn, "event", erow)
            # Re-open completed events whose source updatedAt moved past our last ingest.
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE event SET ingest_status = 'pending'
                    WHERE id = %s AND ingest_status = 'complete'
                      AND updated_at_src IS NOT NULL AND last_ingested_at IS NOT NULL
                      AND updated_at_src > last_ingested_at
                    """,
                    (eid,),
                )

    # ------------------------------------------------------------------
    # event processing
    # ------------------------------------------------------------------

    def _due_events(self, limit: int = 50):
        """Events that need (re-)processing, oldest start first."""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.id, e.external_id, e.tournament_id, e.name, e.state, e.start_at,
                       e.ingest_status, e.ingest_attempts, t.end_at AS t_end_at
                FROM event e
                JOIN tournament t ON t.id = e.tournament_id
                WHERE e.source = %(src)s
                  AND e.ingest_attempts < %(max_attempts)s
                  AND (e.start_at IS NULL OR e.start_at < now() + interval '2 days')
                  AND (
                        e.ingest_status IN ('pending','error')
                     OR (e.ingest_status = 'complete' AND NOT e.is_final AND (
                            -- active or recently-live events: refresh if stale by 6h
                            (e.state IS DISTINCT FROM '3' AND e.state IS DISTINCT FROM 'COMPLETED'
                             AND e.last_ingested_at < now() - interval '6 hours')
                            -- completed but inside the edit window: refresh every 2 days
                         OR (e.last_ingested_at < now() - interval '2 days'
                             AND COALESCE(t.end_at, e.start_at) > now() - make_interval(days => %(overlap)s))
                        ))
                  )
                ORDER BY e.ingest_status IN ('pending','error') DESC, e.start_at NULLS LAST
                LIMIT %(limit)s
                """,
                {
                    "src": SOURCE,
                    "max_attempts": self.cfg.max_ingest_attempts,
                    "overlap": self.cfg.overlap_days,
                    "limit": limit,
                },
            )
            return cur.fetchall()

    def process_due_events(self, deadline: Deadline) -> bool:
        """Returns True when nothing is due."""
        while not deadline.exceeded():
            rows = self._due_events()
            if not rows:
                return True
            for row in rows:
                if deadline.exceeded():
                    return False
                try:
                    self.process_event(row)
                except (ComplexityError, FatalQueryError, KeyError, TypeError, ValueError) as exc:
                    log.exception("event %s failed", row["external_id"])
                    with self.conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE event SET ingest_status = 'error', ingest_error = %s,
                                   ingest_attempts = ingest_attempts + 1
                            WHERE id = %s
                            """,
                            (str(exc)[:1000], row["id"]),
                        )
                    self.conn.commit()
        return False

    def process_event(self, event_row: dict) -> None:
        event_id = event_row["id"]
        ext_id = event_row["external_id"]
        log.info("event %s (%s)", ext_id, event_row.get("name"))
        with self.conn.cursor() as cur:
            cur.execute("UPDATE event SET ingest_status = 'in_progress' WHERE id = %s", (event_id,))
        self.conn.commit()

        phase_map, group_map = self._fetch_event_detail(event_id, ext_id)
        entrant_map = self._fetch_entrants(event_id, ext_id, event_row["tournament_id"])
        self._fetch_seeds(event_id, phase_map, group_map, entrant_map)
        totals = self._fetch_sets(event_id, ext_id, event_row["tournament_id"], group_map, entrant_map)
        self._fetch_standings(event_id, ext_id, entrant_map)

        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE event SET
                    ingest_status = 'complete', ingest_error = NULL, ingest_attempts = 0,
                    last_ingested_at = now(),
                    extra = extra || %s::jsonb,
                    is_final = (
                        (state IN ('3', 'COMPLETED'))
                        AND COALESCE(
                            (SELECT t.end_at FROM tournament t WHERE t.id = event.tournament_id),
                            start_at, now()
                        ) < now() - make_interval(days => %s)
                    )
                WHERE id = %s
                """,
                (db._jsonable(totals), self.cfg.finalize_after_days, event_id),
            )
        self.conn.commit()

    def _fetch_event_detail(self, event_id: int, ext_id: str):
        spec = self.specs["event_detail"]
        sizer = self.sizers["phase_groups"]
        phase_map: dict[str, int] = {}
        group_map: dict[str, int] = {}
        page = 1
        while True:
            try:
                data = self.client.execute(
                    spec, {"eventId": ext_id, "page": page, "perPage": sizer.current}
                )
            except ComplexityError:
                sizer.shrink()
                page = 1
                phase_map.clear()
                group_map.clear()
                continue
            sizer.success()
            ev = data.get("event")
            if not ev:
                raise FatalQueryError(f"event {ext_id} not found (deleted?)")
            if page == 1:
                with self.conn.cursor() as cur:
                    cur.execute("SELECT tournament_id FROM event WHERE id = %s", (event_id,))
                    t_id = cur.fetchone()["tournament_id"]
                erow = nz.event_row(ev, t_id, self.videogame_internal_id)
                db.upsert(self.conn, "event", erow)
            more = False
            for ph in ev.get("phases") or []:
                if not ph:
                    continue
                ph_ext = str(ph["id"])
                if ph_ext not in phase_map:
                    phase_map[ph_ext] = db.upsert(self.conn, "phase", nz.phase_row(ph, event_id))
                groups = ((ph.get("phaseGroups") or {}).get("nodes")) or []
                for pg in groups:
                    if not pg:
                        continue
                    pg_ext = str(pg["id"])
                    if pg_ext not in group_map:
                        group_map[pg_ext] = db.upsert(
                            self.conn, "phase_group", nz.phase_group_row(pg, phase_map[ph_ext])
                        )
                if len(groups) == sizer.current:
                    more = True
            self.conn.commit()
            if not more:
                for ph in ev.get("phases") or []:
                    expected = (ph or {}).get("groupCount")
                    if expected:
                        with self.conn.cursor() as cur:
                            cur.execute(
                                "SELECT count(*) AS n FROM phase_group WHERE phase_id = %s",
                                (phase_map.get(str(ph["id"])),),
                            )
                            got = cur.fetchone()["n"]
                        if got < expected:
                            log.warning(
                                "phase %s: stored %d/%d phase groups (pagination gap?)",
                                ph["id"], got, expected,
                            )
                return phase_map, group_map
            page += 1

    def _ensure_entrant_min(self, event_id: int, ext_id: str, entrant_map: dict[str, int]) -> int:
        if ext_id in entrant_map:
            return entrant_map[ext_id]
        eid = db.upsert(
            self.conn,
            "entrant",
            {
                "source": SOURCE,
                "external_id": ext_id,
                "event_id": event_id,
                "last_ingested_at": utcnow(),
            },
        )
        entrant_map[ext_id] = eid
        return eid

    def _fetch_entrants(self, event_id: int, ext_id: str, tournament_id: int) -> dict[str, int]:
        spec = self.specs["entrants"]
        sizer = self.sizers["entrants"]
        entrant_map: dict[str, int] = {}
        page = 1
        while True:
            try:
                data = self.client.execute(
                    spec, {"eventId": ext_id, "page": page, "perPage": sizer.current}
                )
            except ComplexityError:
                sizer.shrink()
                page = 1
                continue
            sizer.success()
            conn_data = ((data.get("event") or {}).get("entrants")) or {}
            nodes = conn_data.get("nodes") or []
            for node in nodes:
                if not node:
                    continue
                ent_id = db.upsert(self.conn, "entrant", nz.entrant_row(node, event_id))
                entrant_map[str(node["id"])] = ent_id
                with self.conn.cursor() as cur:
                    cur.execute("DELETE FROM entrant_player WHERE entrant_id = %s", (ent_id,))
                for part in node.get("participants") or []:
                    if not part:
                        continue
                    pa_row = nz.player_account_row(part)
                    pa_id = db.upsert(self.conn, "player_account", pa_row) if pa_row else None
                    participant_id = None
                    if part.get("id") is not None:
                        participant_id = db.upsert(
                            self.conn, "participant", nz.participant_row(part, tournament_id, pa_id)
                        )
                    if pa_id is not None:
                        with self.conn.cursor() as cur:
                            cur.execute(
                                """
                                INSERT INTO entrant_player (entrant_id, player_account_id, participant_id)
                                VALUES (%s, %s, %s)
                                ON CONFLICT (entrant_id, player_account_id)
                                DO UPDATE SET participant_id = EXCLUDED.participant_id
                                """,
                                (ent_id, pa_id, participant_id),
                            )
            self.conn.commit()
            total = (conn_data.get("pageInfo") or {}).get("total") or 0
            if not nodes or page * sizer.current >= max(total, 1):
                return entrant_map
            page += 1

    def _fetch_seeds(self, event_id: int, phase_map, group_map, entrant_map) -> None:
        spec = self.specs["seeds"]
        sizer = self.sizers["seeds"]
        for ph_ext, ph_internal in phase_map.items():
            page = 1
            while True:
                try:
                    data = self.client.execute(
                        spec, {"phaseId": ph_ext, "page": page, "perPage": sizer.current}
                    )
                except ComplexityError:
                    sizer.shrink()
                    page = 1
                    continue
                sizer.success()
                conn_data = ((data.get("phase") or {}).get("seeds")) or {}
                nodes = conn_data.get("nodes") or []
                for node in nodes:
                    if not node:
                        continue
                    ent_ext = ((node.get("entrant") or {}).get("id"))
                    ent_internal = (
                        self._ensure_entrant_min(event_id, str(ent_ext), entrant_map)
                        if ent_ext is not None
                        else None
                    )
                    pg_ext = ((node.get("phaseGroup") or {}).get("id"))
                    db.upsert(
                        self.conn,
                        "seed",
                        nz.seed_row(
                            node,
                            ph_internal,
                            group_map.get(str(pg_ext)) if pg_ext is not None else None,
                            ent_internal,
                        ),
                    )
                self.conn.commit()
                total = (conn_data.get("pageInfo") or {}).get("total") or 0
                if not nodes or page * sizer.current >= max(total, 1):
                    break
                page += 1

    def _store_set_node(
        self, node: dict, event_id: int, tournament_id: int, group_map, entrant_map
    ) -> None:
        if nz.is_preview_set(node):
            return
        winner_ext = node.get("winnerId")
        winner_internal = (
            self._ensure_entrant_min(event_id, str(winner_ext), entrant_map)
            if winner_ext is not None
            else None
        )
        for slot in node.get("slots") or []:
            ent = ((slot or {}).get("entrant") or {}).get("id")
            if ent is not None:
                self._ensure_entrant_min(event_id, str(ent), entrant_map)
        pg_ext = ((node.get("phaseGroup") or {}).get("id"))
        stream_internal = None
        stream = node.get("stream")
        if stream and stream.get("id") is not None:
            stream_internal = db.upsert(
                self.conn,
                "stream",
                {
                    "source": SOURCE,
                    "external_id": str(stream["id"]),
                    "tournament_id": tournament_id,
                    "name": stream.get("streamName"),
                    "platform": nz._s(stream.get("streamSource")),
                    "channel": stream.get("streamName"),
                    "raw": stream,
                    "last_ingested_at": utcnow(),
                },
            )
        srow = nz.set_row(
            node,
            event_id,
            group_map.get(str(pg_ext)) if pg_ext is not None else None,
            winner_internal,
            stream_internal,
        )
        slot_rows = nz.set_slot_rows(node, 0, entrant_map)  # set_id patched below
        # prev-set pointers from slot prereqs
        prevs = [r["prereq_external_id"] for r in slot_rows if r.get("prereq_type") == "set"]
        srow["prev_set_external_id_1"] = prevs[0] if len(prevs) > 0 else None
        srow["prev_set_external_id_2"] = prevs[1] if len(prevs) > 1 else None
        set_internal = db.upsert(self.conn, "sets", srow)
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM set_slot WHERE set_id = %s", (set_internal,))
            cur.execute("DELETE FROM game WHERE set_id = %s", (set_internal,))
        for r in slot_rows:
            r["set_id"] = set_internal
        db.insert_many(self.conn, "set_slot", slot_rows)
        game_rows, selections = nz.game_rows(
            node, set_internal, entrant_map, self.character_map, self.stage_map
        )
        for grow, sel_rows in zip(game_rows, selections):
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO game (source, external_id, set_id, order_num, state,
                                      winner_entrant_id, entrant1_score, entrant2_score,
                                      stage_id, stage_name, raw)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        grow["source"], grow["external_id"], grow["set_id"], grow["order_num"],
                        grow["state"], grow["winner_entrant_id"], grow["entrant1_score"],
                        grow["entrant2_score"], grow["stage_id"], grow["stage_name"],
                        db._jsonable(grow["raw"]),
                    ),
                )
                game_internal = cur.fetchone()["id"]
            for sel in sel_rows:
                sel["game_id"] = game_internal
            db.insert_many(self.conn, "game_selection", sel_rows)

    def _fetch_sets(self, event_id: int, ext_id: str, tournament_id: int, group_map, entrant_map) -> dict:
        spec = self.specs["sets"]
        sizer = self.sizers["sets"]
        page, total, stored = 1, None, 0
        while True:
            try:
                data = self.client.execute(
                    spec, {"eventId": ext_id, "page": page, "perPage": sizer.current}
                )
            except ComplexityError:
                sizer.shrink()
                page, total, stored = 1, None, 0
                continue
            sizer.success()
            conn_data = ((data.get("event") or {}).get("sets")) or {}
            if total is None:
                total = (conn_data.get("pageInfo") or {}).get("total") or 0
                if total > PAGINATION_CAP - 500:
                    log.info("event %s has %d sets; fetching per phase group", ext_id, total)
                    return self._fetch_sets_by_group(event_id, tournament_id, group_map, entrant_map)
            nodes = conn_data.get("nodes") or []
            for node in nodes:
                if node:
                    self._store_set_node(node, event_id, tournament_id, group_map, entrant_map)
                    stored += 1
            self.conn.commit()
            if not nodes or page * sizer.current >= max(total, 1):
                break
            page += 1
        return {"sets_total_reported": total, "sets_stored": stored}

    def _fetch_sets_by_group(self, event_id: int, tournament_id: int, group_map, entrant_map) -> dict:
        spec = self.specs["pg_sets"]
        sizer = self.sizers["sets"]
        stored = 0
        for pg_ext in group_map:
            page, total = 1, None
            while True:
                try:
                    data = self.client.execute(
                        spec, {"phaseGroupId": pg_ext, "page": page, "perPage": sizer.current}
                    )
                except ComplexityError:
                    sizer.shrink()
                    page, total = 1, None
                    continue
                sizer.success()
                conn_data = ((data.get("phaseGroup") or {}).get("sets")) or {}
                if total is None:
                    total = (conn_data.get("pageInfo") or {}).get("total") or 0
                nodes = conn_data.get("nodes") or []
                for node in nodes:
                    if node:
                        self._store_set_node(node, event_id, tournament_id, group_map, entrant_map)
                        stored += 1
                self.conn.commit()
                if not nodes or page * sizer.current >= max(total, 1):
                    break
                page += 1
        return {"sets_stored": stored, "fetched_by_group": True}

    def _fetch_standings(self, event_id: int, ext_id: str, entrant_map) -> None:
        spec = self.specs["standings"]
        sizer = self.sizers["standings"]
        page = 1
        while True:
            try:
                data = self.client.execute(
                    spec, {"eventId": ext_id, "page": page, "perPage": sizer.current}
                )
            except ComplexityError:
                sizer.shrink()
                page = 1
                continue
            sizer.success()
            conn_data = ((data.get("event") or {}).get("standings")) or {}
            nodes = conn_data.get("nodes") or []
            for node in nodes:
                if not node:
                    continue
                ent_ext = ((node.get("entrant") or {}).get("id"))
                if ent_ext is None:
                    continue
                ent_internal = self._ensure_entrant_min(event_id, str(ent_ext), entrant_map)
                row = nz.standing_row(node, event_id, ent_internal)
                with self.conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO standing (source, external_id, event_id, entrant_id,
                                              container_type, placement, is_final, stats, raw, last_ingested_at)
                        VALUES (%(source)s, %(external_id)s, %(event_id)s, %(entrant_id)s,
                                %(container_type)s, %(placement)s, %(is_final)s, %(stats)s, %(raw)s, now())
                        ON CONFLICT (event_id, container_type, entrant_id, COALESCE(phase_group_id, 0))
                        DO UPDATE SET placement = EXCLUDED.placement, is_final = EXCLUDED.is_final,
                                      stats = EXCLUDED.stats, raw = EXCLUDED.raw, last_ingested_at = now()
                        """,
                        {**row, "stats": db._jsonable(row["stats"]), "raw": db._jsonable(row["raw"])},
                    )
                with self.conn.cursor() as cur:
                    cur.execute(
                        "UPDATE entrant SET final_placement = %s WHERE id = %s",
                        (node.get("placement"), ent_internal),
                    )
            self.conn.commit()
            total = (conn_data.get("pageInfo") or {}).get("total") or 0
            if not nodes or page * sizer.current >= max(total, 1):
                return
            page += 1

    # ------------------------------------------------------------------
    # entry points
    # ------------------------------------------------------------------

    def backfill(self, deadline: Deadline) -> str:
        self.snapshot_schema()
        self.sync_videogame()
        start = parse_date(self.cfg.backfill_start)
        end = utcnow() + timedelta(days=2)
        if not db.kv_get(self.conn, "startgg.windows_seeded"):
            n = self.seed_windows(start, end)
            db.kv_set(self.conn, "startgg.windows_seeded", {"at": utcnow().isoformat(), "count": n})
            self.conn.commit()
            log.info("seeded %d discovery windows", n)
        windows_done = self.process_windows(deadline)
        if not windows_done:
            return "paused"
        events_done = self.process_due_events(deadline)
        if not events_done:
            return "paused"
        db.kv_set(self.conn, "startgg.watermark", {"at": utcnow().isoformat()})
        self.conn.commit()
        return "success"

    def incremental(self, deadline: Deadline) -> str:
        self.sync_videogame()
        run_started = utcnow()
        wm = db.kv_get(self.conn, "startgg.watermark") or {}
        wm_at = wm.get("at")
        start = (
            parse_date(wm_at[:10]) - timedelta(days=self.cfg.overlap_days)
            if wm_at
            else parse_date(self.cfg.backfill_start)
        )
        end = utcnow() + timedelta(days=self.cfg.horizon_days)
        self.seed_windows(start, end)
        # Always re-scan windows near "now" so tournaments created/updated since
        # the last run are found even when window boundaries already exist.
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE discovery_window SET status = 'pending', updated_at = now()
                WHERE source = %s AND status = 'done'
                  AND window_end > now() - make_interval(days => %s)
                """,
                (SOURCE, self.cfg.overlap_days),
            )
        self.conn.commit()
        windows_done = self.process_windows(deadline)
        events_done = self.process_due_events(deadline) if windows_done else False
        if windows_done and events_done:
            db.kv_set(self.conn, "startgg.watermark", {"at": run_started.isoformat()})
            self.conn.commit()
            return "success"
        return "paused"

    def close(self) -> None:
        self.client.close()
