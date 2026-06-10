"""parry.gg ingestion orchestration.

Backfill walks every public tournament (cursor pagination), keeps the ones
with a Melee event, then fetches per tournament: attendees, streams, and per
Melee event: phases, brackets (full matches with per-game characters, stages
and scores), entrants, users (with linked accounts), and placements.

Incremental passes ``event_updated_since`` so only tournaments whose events
changed since the last watermark are revisited.

parry.gg user accounts can carry a linked start.gg account; when seen, an
identity_event 'link_hint' row is written — these become high-confidence
suggestions for the future player-merge tooling.
"""

from __future__ import annotations

import logging
from datetime import timedelta

import psycopg

from .. import db
from ..config import Config
from ..util import Deadline, iso_to_dt, utcnow
from . import normalize as nz
from .client import ParryClient, to_dict

log = logging.getLogger("algorank.parry")

SOURCE = "parry"


class ParryIngest:
    def __init__(self, cfg: Config, conn: psycopg.Connection):
        self.cfg = cfg
        self.conn = conn
        self.client = ParryClient(cfg.parry_target, cfg.parry_api_key, rps=cfg.parry_rps, timeout=cfg.http_timeout)
        self.melee_game_ext_id: str | None = None
        self.videogame_internal_id: int | None = None
        self.character_map: dict[str, int] = {}
        self.stage_map: dict[str, int] = {}

    # ------------------------------------------------------------------

    def sync_games(self) -> None:
        from parrygg.services.game_service_pb2 import GetGamesRequest

        resp = self.client.call(self.client.games.GetGames, GetGamesRequest())
        db.save_schema_snapshot(
            self.conn, SOURCE, "games", {"sdk": _sdk_version(), "games": [g.name for g in resp.games]}
        )
        for g in resp.games:
            gd = to_dict(g)
            name = (gd.get("name") or "") + " " + (gd.get("slug") or "")
            is_melee = "melee" in name.lower()
            vg_id = db.upsert(
                self.conn,
                "videogame",
                {
                    "source": SOURCE,
                    "external_id": gd["id"],
                    "name": gd.get("name"),
                    "slug": gd.get("slug"),
                    "raw": {k: v for k, v in gd.items() if k not in ("characters", "stages")},
                    "last_ingested_at": utcnow(),
                },
            )
            if not is_melee:
                continue
            self.melee_game_ext_id = gd["id"]
            self.videogame_internal_id = vg_id
            for ch in gd.get("characters") or []:
                cid = db.upsert(
                    self.conn,
                    "game_character",
                    {
                        "source": SOURCE,
                        "external_id": ch["id"],
                        "videogame_id": vg_id,
                        "name": ch.get("name"),
                        "slug": ch.get("slug"),
                        "raw": ch,
                        "last_ingested_at": utcnow(),
                    },
                )
                self.character_map[ch["id"]] = cid
                if ch.get("slug"):
                    self.character_map[ch["slug"]] = cid
            for st in gd.get("stages") or []:
                sid = db.upsert(
                    self.conn,
                    "stage",
                    {
                        "source": SOURCE,
                        "external_id": st["id"],
                        "videogame_id": vg_id,
                        "name": st.get("name"),
                        "slug": st.get("slug"),
                        "raw": st,
                        "last_ingested_at": utcnow(),
                    },
                )
                self.stage_map[st["id"]] = sid
                if st.get("slug"):
                    self.stage_map[st["slug"]] = sid
        self.conn.commit()
        if not self.melee_game_ext_id:
            raise RuntimeError("could not find Melee in parry.gg games list")
        log.info(
            "parry Melee game id %s (%d characters, %d stages)",
            self.melee_game_ext_id, len(self.character_map), len(self.stage_map),
        )

    # ------------------------------------------------------------------
    # discovery
    # ------------------------------------------------------------------

    def discover(self, updated_since=None) -> int:
        from parrygg.services.tournament_service_pb2 import GetTournamentsRequest

        found = 0
        cursor = None
        while True:
            req = GetTournamentsRequest()
            req.pagination_request.page_size = 50
            if cursor is not None:
                req.pagination_request.cursor.CopyFrom(cursor)
            if updated_since is not None:
                req.filter.event_updated_since.FromDatetime(updated_since)
            resp = self.client.call(self.client.tournaments.GetTournaments, req)
            for t in resp.tournaments:
                td = to_dict(t)
                melee_events = [
                    e for e in td.get("events") or []
                    if (e.get("game") or {}).get("id") == self.melee_game_ext_id
                ]
                if not melee_events:
                    continue
                trow = nz.tournament_row(td)
                tid = db.upsert(self.conn, "tournament", trow)
                for e in melee_events:
                    erow = nz.event_row(e, tid, self.videogame_internal_id)
                    eid = db.upsert(self.conn, "event", erow)
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
                found += 1
            self.conn.commit()
            pr = resp.pagination_response
            if not pr.has_more:
                break
            cursor = pr.next_cursor
        log.info("parry discovery: %d Melee tournaments", found)
        return found

    # ------------------------------------------------------------------
    # per-tournament / per-event processing
    # ------------------------------------------------------------------

    def _due_events(self, limit: int = 25):
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.id, e.external_id, e.tournament_id, e.name, e.state,
                       t.external_id AS tournament_external_id, t.end_at AS t_end_at
                FROM event e JOIN tournament t ON t.id = e.tournament_id
                WHERE e.source = %(src)s
                  AND e.ingest_attempts < %(max_attempts)s
                  AND (e.start_at IS NULL OR e.start_at < now() + interval '2 days')
                  AND (
                        e.ingest_status IN ('pending','error')
                     OR (e.ingest_status = 'complete' AND NOT e.is_final
                         AND e.state IS DISTINCT FROM 'EVENT_STATE_COMPLETED'
                         AND e.last_ingested_at < now() - interval '6 hours')
                  )
                ORDER BY e.ingest_status IN ('pending','error') DESC, e.start_at NULLS LAST
                LIMIT %(limit)s
                """,
                {"src": SOURCE, "max_attempts": self.cfg.max_ingest_attempts, "limit": limit},
            )
            return cur.fetchall()

    def process_due_events(self, deadline: Deadline) -> bool:
        processed_tournaments: set[int] = set()
        while not deadline.exceeded():
            rows = self._due_events()
            if not rows:
                return True
            for row in rows:
                if deadline.exceeded():
                    return False
                try:
                    if row["tournament_id"] not in processed_tournaments:
                        self.process_tournament_extras(row["tournament_id"], row["tournament_external_id"])
                        processed_tournaments.add(row["tournament_id"])
                    self.process_event(row)
                except Exception as exc:
                    log.exception("parry event %s failed", row["external_id"])
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

    def process_tournament_extras(self, tournament_id: int, tournament_ext_id: str) -> None:
        """Attendees and streams, fetched once per tournament per run."""
        from parrygg.services.tournament_service_pb2 import GetTournamentAttendeesRequest
        from parrygg.services.stream_service_pb2 import GetTournamentStreamsRequest

        try:
            req = GetTournamentAttendeesRequest(tournament_id=tournament_ext_id)
            resp = self.client.call(self.client.tournaments.GetTournamentAttendees, req)
            for att in resp.attendees:
                ad = to_dict(att)
                user = ad.get("user") or {}
                pa_id = None
                if user.get("id"):
                    pa_id = self._upsert_user(user)
                db.upsert(
                    self.conn,
                    "participant",
                    {
                        "source": SOURCE,
                        "external_id": f"{tournament_ext_id}:{user.get('id', 'unknown')}",
                        "tournament_id": tournament_id,
                        "player_account_id": pa_id,
                        "gamer_tag": user.get("gamer_tag"),
                        "prefix": user.get("sponsor_name"),
                        "raw": ad,
                        "last_ingested_at": utcnow(),
                    },
                )
            self.conn.commit()
        except Exception as exc:
            log.warning("attendees fetch failed for %s: %s", tournament_ext_id, exc)
            self.conn.rollback()

        try:
            req = GetTournamentStreamsRequest()
            req.tournament_identifier.id = tournament_ext_id
            resp = self.client.call(self.client.streams.GetTournamentStreams, req)
            for st in resp.streams:
                sd = to_dict(st)
                db.upsert(
                    self.conn,
                    "stream",
                    {
                        "source": SOURCE,
                        "external_id": sd.get("id"),
                        "tournament_id": tournament_id,
                        "name": sd.get("display_name") or sd.get("channel"),
                        "platform": sd.get("platform"),
                        "channel": sd.get("channel"),
                        "display_name": sd.get("display_name"),
                        "capacity": sd.get("capacity"),
                        "raw": sd,
                        "last_ingested_at": utcnow(),
                    },
                )
            self.conn.commit()
        except Exception as exc:
            log.warning("streams fetch failed for %s: %s", tournament_ext_id, exc)
            self.conn.rollback()

    def _upsert_user(self, user: dict) -> int:
        row = nz.user_to_player_account_row(user)
        pa_id = db.upsert(self.conn, "player_account", row)
        connections = row.get("connections") or {}
        if "startgg" in connections:
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO identity_event (kind, player_account_id, reason, payload)
                    SELECT 'link_hint', %s, 'parry user has linked start.gg account', %s
                    WHERE NOT EXISTS (
                        SELECT 1 FROM identity_event
                        WHERE kind = 'link_hint' AND player_account_id = %s
                    )
                    """,
                    (pa_id, db._jsonable(connections["startgg"]), pa_id),
                )
        return pa_id

    def _upsert_event_entrant(self, ee: dict, event_id: int, entrant_map: dict[str, int]) -> int | None:
        ext = ee.get("id")
        if not ext:
            return None
        if ext in entrant_map:
            return entrant_map[ext]
        ent_id = db.upsert(self.conn, "entrant", nz.event_entrant_row(ee, event_id))
        entrant_map[ext] = ent_id
        for user in (ee.get("entrant") or {}).get("users") or []:
            if not user.get("id"):
                continue
            pa_id = self._upsert_user(user)
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO entrant_player (entrant_id, player_account_id)
                    VALUES (%s, %s) ON CONFLICT DO NOTHING
                    """,
                    (ent_id, pa_id),
                )
        return ent_id

    def process_event(self, event_row: dict) -> None:
        from parrygg.services.event_service_pb2 import (
            GetEventRequest,
            GetEventOptions,
            GetEventPlacementsRequest,
            GetEventEntrantsRequest,
        )
        from parrygg.services.user_service_pb2 import GetUsersRequest
        from parrygg.services.phase_service_pb2 import GetPhaseRequest
        from parrygg.services.bracket_service_pb2 import GetBracketRequest

        event_id = event_row["id"]
        ext_id = event_row["external_id"]
        log.info("parry event %s (%s)", ext_id, event_row.get("name"))
        with self.conn.cursor() as cur:
            cur.execute("UPDATE event SET ingest_status = 'in_progress' WHERE id = %s", (event_id,))
        self.conn.commit()

        req = GetEventRequest(id=ext_id)
        req.options.CopyFrom(GetEventOptions(event_view=1))  # EVENT_VIEW_BRACKET_SUMMARY
        resp = self.client.call(self.client.events.GetEvent, req)
        ed = to_dict(resp.event)
        db.upsert(self.conn, "event", nz.event_row(ed, event_row["tournament_id"], self.videogame_internal_id))

        entrant_map: dict[str, int] = {}

        # Entrants first so bracket slots can resolve to them.
        try:
            ereq = GetEventEntrantsRequest()
            ereq.event_identifier.id = ext_id
            eresp = self.client.call(self.client.events.GetEventEntrants, ereq)
            for ee in eresp.event_entrants:
                self._upsert_event_entrant(to_dict(ee), event_id, entrant_map)
            self.conn.commit()
        except Exception as exc:
            log.warning("entrants fetch failed for event %s: %s", ext_id, exc)
            self.conn.rollback()

        phases = ed.get("phases") or []
        for ordinal, ph in enumerate(phases):
            ph_internal = db.upsert(self.conn, "phase", nz.phase_row(ph, event_id, ordinal))
            brackets = ph.get("brackets") or []
            if not brackets:
                presp = self.client.call(self.client.phases.GetPhase, GetPhaseRequest(id=ph["id"]))
                brackets = to_dict(presp.phase).get("brackets") or []
            for b in brackets:
                bresp = self.client.call(self.client.brackets.GetBracket, GetBracketRequest(id=b["id"]))
                bd = to_dict(bresp.bracket)
                self._store_bracket(bd, event_id, ph_internal, entrant_map)
            self.conn.commit()

        # Placements (event standings).
        try:
            preq = GetEventPlacementsRequest(id=ext_id)
            presp = self.client.call(self.client.events.GetEventPlacements, preq)
            for pl in presp.placements:
                pld = to_dict(pl)
                ee = pld.get("event_entrant") or {}
                ent_internal = self._upsert_event_entrant(ee, event_id, entrant_map)
                if ent_internal is None:
                    continue
                with self.conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO standing (source, event_id, entrant_id, container_type,
                                              placement, wins, losses, seed_num, raw, last_ingested_at)
                        VALUES (%s, %s, %s, 'event', %s, %s, %s, %s, %s, now())
                        ON CONFLICT (event_id, container_type, entrant_id, COALESCE(phase_group_id, 0))
                        DO UPDATE SET placement = EXCLUDED.placement, wins = EXCLUDED.wins,
                                      losses = EXCLUDED.losses, seed_num = EXCLUDED.seed_num,
                                      raw = EXCLUDED.raw, last_ingested_at = now()
                        """,
                        (
                            SOURCE, event_id, ent_internal, pld.get("placement"),
                            pld.get("wins"), pld.get("losses"), pld.get("seed"),
                            db._jsonable(pld),
                        ),
                    )
                    cur.execute(
                        "UPDATE entrant SET final_placement = %s WHERE id = %s",
                        (pld.get("placement"), ent_internal),
                    )
            self.conn.commit()
        except Exception as exc:
            log.warning("placements fetch failed for event %s: %s", ext_id, exc)
            self.conn.rollback()

        # Full user profiles for everyone in the event (includes anonymous).
        try:
            ureq = GetUsersRequest()
            ureq.filter.event_id = ext_id
            ureq.filter.include_anonymous_users = True
            uresp = self.client.call(self.client.users.GetUsers, ureq)
            for u in uresp.users:
                self._upsert_user(to_dict(u))
            self.conn.commit()
        except Exception as exc:
            log.warning("users fetch failed for event %s: %s", ext_id, exc)
            self.conn.rollback()

        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE event SET ingest_status = 'complete', ingest_error = NULL,
                       ingest_attempts = 0, last_ingested_at = now(),
                       is_final = (
                           state = 'EVENT_STATE_COMPLETED'
                           AND COALESCE(
                               (SELECT t.end_at FROM tournament t WHERE t.id = event.tournament_id),
                               start_at, now()
                           ) < now() - make_interval(days => %s)
                       )
                WHERE id = %s
                """,
                (self.cfg.finalize_after_days, event_id),
            )
        self.conn.commit()

    def _store_bracket(self, bd: dict, event_id: int, phase_internal: int, entrant_map: dict[str, int]) -> None:
        pg_internal = db.upsert(self.conn, "phase_group", nz.bracket_to_phase_group_row(bd, phase_internal))

        # Seeds: map seed id -> entrant internal id.
        seed_entrant_map: dict[str, int | None] = {}
        for s in list(bd.get("seeds") or []) + list(bd.get("progressed_seeds") or []):
            ee = s.get("event_entrant") or {}
            ent_internal = self._upsert_event_entrant(ee, event_id, entrant_map) if ee.get("id") else None
            seed_entrant_map[s.get("id")] = ent_internal
            db.upsert(self.conn, "seed", nz.seed_row(s, pg_internal, ent_internal))

        for prog in bd.get("progressions") or []:
            db.upsert(
                self.conn,
                "progression",
                {
                    "source": SOURCE,
                    "external_id": prog.get("id"),
                    "event_id": event_id,
                    "origin_phase_group_id": pg_internal,
                    "origin_set_external_id": prog.get("match_id"),
                    "seed_external_id": prog.get("seed_id"),
                    "origin_placement": prog.get("origin_placement"),
                    "origin_seed": prog.get("origin_seed"),
                    "match_winner": prog.get("match_winner"),
                    "winners_side": prog.get("winners_side"),
                    "raw": prog,
                    "last_ingested_at": utcnow(),
                },
            )

        labels = nz.round_label_map(bd)
        for m in bd.get("matches") or []:
            winner_seed = nz.match_winner_seed_id(m)
            winner_internal = seed_entrant_map.get(winner_seed) if winner_seed else None
            srow = nz.match_to_set_row(m, event_id, pg_internal, winner_internal, labels)
            set_internal = db.upsert(self.conn, "sets", srow)
            with self.conn.cursor() as cur:
                cur.execute("DELETE FROM set_slot WHERE set_id = %s", (set_internal,))
                cur.execute("DELETE FROM game WHERE set_id = %s", (set_internal,))
            slot_rows = nz.match_slot_rows(m, set_internal, seed_entrant_map)
            db.insert_many(self.conn, "set_slot", slot_rows)
            # slot index -> entrant, for game participant resolution
            slot_entrants = {r["slot_index"]: r["entrant_id"] for r in slot_rows}
            for mg in m.get("match_games") or []:
                self._store_match_game(mg, set_internal, slot_entrants)

    def _store_match_game(self, mg: dict, set_internal: int, slot_entrants: dict) -> None:
        stages = mg.get("stages") or []
        stage0 = stages[0] if stages else {}
        slots = mg.get("slots") or []
        winner_entrant = None
        scores: dict[int, float | None] = {}
        for gs in slots:
            idx = gs.get("slot")
            scores[idx] = gs.get("score")
            if gs.get("placement") == 1:
                winner_entrant = slot_entrants.get(idx)
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO game (source, external_id, set_id, order_num, state,
                                  winner_entrant_id, entrant1_score, entrant2_score,
                                  stage_id, stage_name, started_at, ended_at, raw)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (set_id, order_num) DO UPDATE SET raw = EXCLUDED.raw
                RETURNING id
                """,
                (
                    SOURCE, mg.get("id"), set_internal,
                    (mg.get("index") if mg.get("index") is not None else 0) + 1,
                    mg.get("state"), winner_entrant,
                    scores.get(0), scores.get(1),
                    self.stage_map.get(stage0.get("id")), stage0.get("name"),
                    iso_to_dt(mg.get("started_at")), iso_to_dt(mg.get("ended_at")),
                    db._jsonable(mg),
                ),
            )
            game_internal = cur.fetchone()["id"]
        gslot_rows, sel_rows = [], []
        for gs in slots:
            idx = gs.get("slot")
            gslot_rows.append(
                {
                    "game_id": game_internal,
                    "slot_index": idx,
                    "entrant_id": slot_entrants.get(idx),
                    "score": gs.get("score"),
                    "placement": gs.get("placement"),
                    "slot_state": gs.get("state"),
                    "raw": gs,
                }
            )
            for part in gs.get("participants") or []:
                pa_ext = part.get("user_id")
                for ch in part.get("characters") or []:
                    sel_rows.append(
                        {
                            "game_id": game_internal,
                            "slot_index": idx,
                            "entrant_id": slot_entrants.get(idx),
                            "player_account_id": self._player_account_id(pa_ext),
                            "selection_type": "CHARACTER",
                            "character_id": self.character_map.get(ch.get("id")) or self.character_map.get(ch.get("slug")),
                            "value_external_id": ch.get("id"),
                            "value_name": ch.get("name"),
                            "raw": {"participant": part, "character": ch},
                        }
                    )
        db.insert_many(self.conn, "game_slot", gslot_rows)
        db.insert_many(self.conn, "game_selection", sel_rows)

    def _player_account_id(self, user_ext_id: str | None) -> int | None:
        if not user_ext_id:
            return None
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM player_account WHERE source = %s AND external_id = %s",
                (SOURCE, user_ext_id),
            )
            row = cur.fetchone()
        if row:
            return row["id"]
        return db.upsert(
            self.conn,
            "player_account",
            {"source": SOURCE, "external_id": user_ext_id, "last_ingested_at": utcnow()},
        )

    # ------------------------------------------------------------------
    # entry points
    # ------------------------------------------------------------------

    def backfill(self, deadline: Deadline) -> str:
        self.sync_games()
        self.discover(updated_since=None)
        done = self.process_due_events(deadline)
        if done:
            db.kv_set(self.conn, "parry.watermark", {"at": utcnow().isoformat()})
            self.conn.commit()
            return "success"
        return "paused"

    def incremental(self, deadline: Deadline) -> str:
        self.sync_games()
        run_started = utcnow()
        wm = db.kv_get(self.conn, "parry.watermark") or {}
        since = None
        if wm.get("at"):
            since = (iso_to_dt(wm["at"]) - timedelta(days=self.cfg.overlap_days)).replace(tzinfo=None)
        self.discover(updated_since=since)
        done = self.process_due_events(deadline)
        if done:
            db.kv_set(self.conn, "parry.watermark", {"at": run_started.isoformat()})
            self.conn.commit()
            return "success"
        return "paused"

    def close(self) -> None:
        self.client.close()


def _sdk_version() -> str:
    try:
        import parrygg

        return getattr(parrygg, "__version__", "unknown")
    except Exception:
        return "unavailable"
