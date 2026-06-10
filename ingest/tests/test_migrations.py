"""Validate migration SQL parses as PostgreSQL (via pglast/libpg_query)."""

from pathlib import Path

import pytest

MIGRATIONS = sorted((Path(__file__).parent.parent.parent / "db" / "migrations").glob("*.sql"))


def test_migrations_exist():
    assert MIGRATIONS, "no migration files found"
    versions = [int(p.name.split("_", 1)[0]) for p in MIGRATIONS]
    assert versions == sorted(set(versions)), "duplicate/unsorted migration versions"


def test_migrations_parse():
    pglast = pytest.importorskip("pglast")
    for path in MIGRATIONS:
        pglast.parse_sql(path.read_text())  # raises on syntax error
