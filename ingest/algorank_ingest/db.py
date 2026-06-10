"""Database access: migrations, generic upserts, bookkeeping helpers.

All writes are idempotent: sourced tables upsert on (source, external_id),
children of a set are replaced atomically with their parent row's update.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

log = logging.getLogger("algorank.db")

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "db" / "migrations"


def connect(database_url: str) -> psycopg.Connection:
    conn = psycopg.connect(database_url, row_factory=dict_row, autocommit=False)
    return conn


def migrate(conn: psycopg.Connection, migrations_dir: Path | None = None) -> list[int]:
    """Apply pending SQL migrations in version order."""
    mdir = migrations_dir or MIGRATIONS_DIR
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'schema_migrations'
            ) AS present
            """
        )
        present = cur.fetchone()["present"]
        applied: set[int] = set()
        if present:
            cur.execute("SELECT version FROM schema_migrations")
            applied = {r["version"] for r in cur.fetchall()}
    ran: list[int] = []
    for path in sorted(mdir.glob("*.sql")):
        version = int(path.name.split("_", 1)[0])
        if version in applied:
            continue
        log.info("applying migration %s", path.name)
        sql = path.read_text()
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        ran.append(version)
    return ran


def _jsonable(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return Jsonb(value, dumps=lambda o: json.dumps(o, default=str))
    return value


def upsert(
    conn: psycopg.Connection,
    table: str,
    row: dict[str, Any],
    conflict_cols: tuple[str, ...] = ("source", "external_id"),
    returning: str = "id",
) -> Any:
    """Generic UPSERT. Columns absent from `row` are left untouched on update."""
    cols = list(row.keys())
    vals = [_jsonable(row[c]) for c in cols]
    placeholders = ", ".join(["%s"] * len(cols))
    col_sql = ", ".join(cols)
    update_cols = [c for c in cols if c not in conflict_cols]
    if update_cols:
        set_sql = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
        sql = (
            f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders}) "
            f"ON CONFLICT ({', '.join(conflict_cols)}) DO UPDATE SET {set_sql} "
            f"RETURNING {returning}"
        )
    else:
        sql = (
            f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders}) "
            f"ON CONFLICT ({', '.join(conflict_cols)}) DO UPDATE SET {conflict_cols[0]} = EXCLUDED.{conflict_cols[0]} "
            f"RETURNING {returning}"
        )
    with conn.cursor() as cur:
        cur.execute(sql, vals)
        out = cur.fetchone()
    return out[returning] if out else None


def insert_many(conn: psycopg.Connection, table: str, rows: Iterable[dict[str, Any]]) -> None:
    rows = list(rows)
    if not rows:
        return
    cols = list(rows[0].keys())
    placeholders = ", ".join(["%s"] * len(cols))
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})"
    with conn.cursor() as cur:
        cur.executemany(sql, [[_jsonable(r[c]) for c in cols] for r in rows])


def kv_get(conn: psycopg.Connection, key: str, default: Any = None) -> Any:
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM kv_state WHERE key = %s", (key,))
        row = cur.fetchone()
    return row["value"] if row else default


def kv_set(conn: psycopg.Connection, key: str, value: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO kv_state (key, value, updated_at) VALUES (%s, %s, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
            """,
            (key, _jsonable(value)),
        )


def start_sync_run(conn: psycopg.Connection, source: str, kind: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sync_run (source, kind) VALUES (%s, %s) RETURNING id",
            (source, kind),
        )
        run_id = cur.fetchone()["id"]
    conn.commit()
    return run_id


def finish_sync_run(
    conn: psycopg.Connection, run_id: int, status: str, stats: dict | None = None, error: str | None = None
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sync_run SET finished_at = now(), status = %s,
                   stats = COALESCE(%s, stats), error = %s
            WHERE id = %s
            """,
            (status, _jsonable(stats), error, run_id),
        )
    conn.commit()


def record_field_fallback(
    conn: psycopg.Connection, source: str, query_name: str, kind: str, name: str, error_message: str
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO api_field_fallback (source, query_name, kind, name, error_message)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (source, query_name, kind, name)
            DO UPDATE SET last_seen_at = now(), error_message = EXCLUDED.error_message
            """,
            (source, query_name, kind, name, error_message),
        )
    conn.commit()


def load_field_fallbacks(conn: psycopg.Connection, source: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT query_name, kind, name FROM api_field_fallback WHERE source = %s",
            (source,),
        )
        return cur.fetchall()


def save_schema_snapshot(conn: psycopg.Connection, source: str, label: str, payload: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO schema_snapshot (source, label, payload) VALUES (%s, %s, %s)",
            (source, label, _jsonable(payload)),
        )
    conn.commit()
