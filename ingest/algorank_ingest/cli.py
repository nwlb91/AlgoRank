"""AlgoRank command line interface.

    algorank migrate                       apply database migrations
    algorank backfill startgg|parry|all    full historical ingestion (resumable)
    algorank sync startgg|parry|all        incremental update since last watermark
    algorank verify                        check DB/API credentials & report counts
    algorank status                        show ingestion progress
    algorank resync-event --source startgg --external-id 12345
"""

from __future__ import annotations

import argparse
import sys

from . import db
from .config import Config
from .util import Deadline, setup_logging


def _connect(cfg: Config):
    if not cfg.database_url:
        sys.exit("DATABASE_URL is not set")
    return db.connect(cfg.database_url)


def cmd_migrate(cfg: Config, args) -> int:
    conn = _connect(cfg)
    ran = db.migrate(conn)
    print(f"applied migrations: {ran or 'none (up to date)'}")
    return 0


def _run(cfg: Config, source: str, kind: str, args) -> int:
    conn = _connect(cfg)
    db.migrate(conn)
    deadline = Deadline(args.max_minutes or cfg.max_runtime_minutes)
    statuses = []
    sources = ["startgg", "parry"] if source == "all" else [source]
    for src in sources:
        if src == "startgg" and not cfg.startgg_token:
            print("skipping startgg: STARTGG_API_TOKEN not set", file=sys.stderr)
            continue
        if src == "parry" and not cfg.parry_api_key:
            print("skipping parry: PARRY_API_KEY not set", file=sys.stderr)
            continue
        run_id = db.start_sync_run(conn, src, kind)
        try:
            if src == "startgg":
                from .startgg.ingest import StartGGIngest

                ing = StartGGIngest(cfg, conn)
            else:
                from .parry.ingest import ParryIngest

                ing = ParryIngest(cfg, conn)
            try:
                status = ing.backfill(deadline) if kind == "backfill" else ing.incremental(deadline)
                db.finish_sync_run(conn, run_id, status, {"requests": ing.client.request_count})
                statuses.append(status)
                print(f"{src} {kind}: {status} ({ing.client.request_count} API requests)")
            finally:
                ing.close()
        except KeyboardInterrupt:
            db.finish_sync_run(conn, run_id, "paused", error="interrupted")
            print(f"{src} {kind}: interrupted (resume by re-running)")
            return 130
        except Exception as exc:
            conn.rollback()
            db.finish_sync_run(conn, run_id, "error", error=str(exc)[:2000])
            raise
    return 0 if all(s == "success" for s in statuses) else 3  # 3 = paused, re-run to continue


def cmd_verify(cfg: Config, args) -> int:
    ok = True
    conn = None
    try:
        conn = _connect(cfg)
        db.migrate(conn)
        print("database: OK")
    except Exception as exc:
        print(f"database: FAILED ({exc})")
        return 1
    if cfg.startgg_token:
        try:
            from .startgg.client import StartGGClient
            from .startgg.queries import videogame_check

            client = StartGGClient(cfg.startgg_url, cfg.startgg_token, rpm=cfg.startgg_rpm)
            data = client.execute(videogame_check(), {"videogameId": cfg.melee_videogame_id})
            vg = data.get("videogame") or {}
            print(f"start.gg: OK (videogame {cfg.melee_videogame_id} = {vg.get('name')})")
            client.close()
        except Exception as exc:
            ok = False
            print(f"start.gg: FAILED ({exc})")
    else:
        print("start.gg: skipped (no STARTGG_API_TOKEN)")
    if cfg.parry_api_key:
        try:
            from parrygg.services.game_service_pb2 import GetGamesRequest

            from .parry.client import ParryClient

            client = ParryClient(cfg.parry_target, cfg.parry_api_key, rps=cfg.parry_rps)
            resp = client.call(client.games.GetGames, GetGamesRequest())
            names = [g.name for g in resp.games]
            melee = [n for n in names if "melee" in n.lower()]
            print(f"parry.gg: OK ({len(names)} games, melee={melee or 'NOT FOUND'})")
            client.close()
        except Exception as exc:
            ok = False
            print(f"parry.gg: FAILED ({exc})")
    else:
        print("parry.gg: skipped (no PARRY_API_KEY)")
    if conn:
        _print_status(conn)
    return 0 if ok else 1


def _print_status(conn) -> None:
    tables = [
        "tournament", "event", "phase", "phase_group", "entrant", "player_account",
        "participant", "sets", "set_slot", "game", "game_slot", "game_selection",
        "seed", "standing", "progression", "stream", "person",
    ]
    print("\nrow counts:")
    with conn.cursor() as cur:
        for t in tables:
            cur.execute(f"SELECT count(*) AS n FROM {t}")  # noqa: S608 (fixed list)
            print(f"  {t:18s} {cur.fetchone()['n']:>12,}")
        cur.execute(
            """
            SELECT source, ingest_status, count(*) AS n FROM event
            GROUP BY source, ingest_status ORDER BY source, ingest_status
            """
        )
        rows = cur.fetchall()
        if rows:
            print("\nevent ingest status:")
            for r in rows:
                print(f"  {r['source']:8s} {r['ingest_status']:12s} {r['n']:>10,}")
        cur.execute(
            """
            SELECT source, status, count(*) AS n FROM discovery_window
            GROUP BY source, status ORDER BY source, status
            """
        )
        rows = cur.fetchall()
        if rows:
            print("\ndiscovery windows:")
            for r in rows:
                print(f"  {r['source']:8s} {r['status']:12s} {r['n']:>10,}")
        cur.execute(
            "SELECT source, kind, status, started_at, finished_at FROM sync_run ORDER BY id DESC LIMIT 5"
        )
        rows = cur.fetchall()
        if rows:
            print("\nrecent runs:")
            for r in rows:
                print(
                    f"  {r['started_at']:%Y-%m-%d %H:%M} {r['source']:8s} {r['kind']:12s} {r['status']}"
                )
        cur.execute("SELECT count(*) AS n FROM api_field_fallback")
        n = cur.fetchone()["n"]
        if n:
            print(f"\nWARNING: {n} fields/args were rejected by APIs and dropped — "
                  "see table api_field_fallback")


def cmd_status(cfg: Config, args) -> int:
    conn = _connect(cfg)
    _print_status(conn)
    return 0


def cmd_resync_event(cfg: Config, args) -> int:
    conn = _connect(cfg)
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE event SET ingest_status = 'pending', ingest_attempts = 0, ingest_error = NULL,
                   is_final = FALSE
            WHERE source = %s AND external_id = %s
            RETURNING id, name
            """,
            (args.source, args.external_id),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        print("event not found")
        return 1
    print(f"event {row['id']} ({row['name']}) marked for re-ingestion; run `algorank sync {args.source}`")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="algorank", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("migrate")

    for name in ("backfill", "sync"):
        p = sub.add_parser(name)
        p.add_argument("source", choices=["startgg", "parry", "all"])
        p.add_argument("--max-minutes", type=int, default=0, help="stop gracefully after N minutes (resumable)")

    sub.add_parser("verify")
    sub.add_parser("status")

    p = sub.add_parser("resync-event")
    p.add_argument("--source", required=True, choices=["startgg", "parry"])
    p.add_argument("--external-id", required=True)

    args = parser.parse_args(argv)
    cfg = Config.from_env()
    setup_logging(cfg.log_level)

    if args.command == "migrate":
        return cmd_migrate(cfg, args)
    if args.command == "backfill":
        return _run(cfg, args.source, "backfill", args)
    if args.command == "sync":
        return _run(cfg, args.source, "incremental", args)
    if args.command == "verify":
        return cmd_verify(cfg, args)
    if args.command == "status":
        return cmd_status(cfg, args)
    if args.command == "resync-event":
        return cmd_resync_event(cfg, args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
