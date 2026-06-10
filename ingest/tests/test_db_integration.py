"""End-to-end database tests. Run only when ALGORANK_TEST_DATABASE_URL is set
(they create/drop a schema in that database).
"""

import json
import os
from pathlib import Path

import pytest

DB_URL = os.environ.get("ALGORANK_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="ALGORANK_TEST_DATABASE_URL not set")

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def conn():
    from algorank_ingest import db as adb

    conn = adb.connect(DB_URL)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    conn.commit()
    adb.migrate(conn)
    yield conn
    conn.close()


def _mk_cfg():
    from algorank_ingest.config import Config

    return Config(database_url=DB_URL, startgg_token="x", parry_api_key="x")


def test_migrate_idempotent(conn):
    from algorank_ingest import db as adb

    assert adb.migrate(conn) == []  # second call: nothing to do


def test_generic_upserts_and_set_storage(conn):
    from algorank_ingest import db as adb
    from algorank_ingest.startgg import normalize as nz
    from algorank_ingest.startgg.ingest import StartGGIngest

    tid = adb.upsert(conn, "tournament", {"source": "startgg", "external_id": "t1", "name": "Test Major"})
    # upsert same row twice -> same id
    assert adb.upsert(conn, "tournament", {"source": "startgg", "external_id": "t1", "name": "Test Major 2"}) == tid
    eid = adb.upsert(conn, "event", {"source": "startgg", "external_id": "e1", "tournament_id": tid, "name": "Melee Singles"})

    ing = StartGGIngest(_mk_cfg(), conn)
    ing.character_map = {"1": adb.upsert(conn, "game_character", {"source": "startgg", "external_id": "1", "name": "Fox"}),
                         "19": adb.upsert(conn, "game_character", {"source": "startgg", "external_id": "19", "name": "Marth"})}
    ing.stage_map = {"3": adb.upsert(conn, "stage", {"source": "startgg", "external_id": "3", "name": "Battlefield"}),
                     "8": adb.upsert(conn, "stage", {"source": "startgg", "external_id": "8", "name": "Yoshi's Story"})}

    node = json.loads((FIXTURES / "startgg_set_node.json").read_text())
    entrant_map = {}
    ing._store_set_node(node, eid, tid, group_map={}, entrant_map=entrant_map)
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("SELECT * FROM sets")
        sets = cur.fetchall()
        assert len(sets) == 1
        s = sets[0]
        assert s["external_id"] == "60086798"
        assert s["prev_set_external_id_1"] == "60086790"
        cur.execute("SELECT count(*) AS n FROM set_slot WHERE set_id = %s", (s["id"],))
        assert cur.fetchone()["n"] == 2
        cur.execute("SELECT count(*) AS n FROM game WHERE set_id = %s", (s["id"],))
        assert cur.fetchone()["n"] == 2
        cur.execute("SELECT count(*) AS n FROM game_selection")
        assert cur.fetchone()["n"] == 4

    # re-store the same set: children replaced, not duplicated
    ing._store_set_node(node, eid, tid, group_map={}, entrant_map=entrant_map)
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM sets")
        assert cur.fetchone()["n"] == 1
        cur.execute("SELECT count(*) AS n FROM game")
        assert cur.fetchone()["n"] == 2
        cur.execute("SELECT count(*) AS n FROM game_selection")
        assert cur.fetchone()["n"] == 4


def test_standing_expression_on_conflict(conn):
    from algorank_ingest import db as adb
    from algorank_ingest.startgg.ingest import StartGGIngest

    tid = adb.upsert(conn, "tournament", {"source": "startgg", "external_id": "t2"})
    eid = adb.upsert(conn, "event", {"source": "startgg", "external_id": "e2", "tournament_id": tid})
    ing = StartGGIngest(_mk_cfg(), conn)
    entrant_map = {}
    node = {"id": "st1", "placement": 3, "isFinal": True, "entrant": {"id": "777"}}

    # emulate two standings fetches: second must UPDATE, not duplicate
    for placement in (3, 2):
        node["placement"] = placement
        ent = ing._ensure_entrant_min(eid, "777", entrant_map)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO standing (source, external_id, event_id, entrant_id,
                                      container_type, placement, is_final, stats, raw, last_ingested_at)
                VALUES ('startgg', %s, %s, %s, 'event', %s, TRUE, NULL, NULL, now())
                ON CONFLICT (event_id, container_type, entrant_id, COALESCE(phase_group_id, 0))
                DO UPDATE SET placement = EXCLUDED.placement, last_ingested_at = now()
                """,
                (node["id"], eid, ent, node["placement"]),
            )
        conn.commit()
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n, min(placement) AS p FROM standing WHERE event_id = %s", (eid,))
        row = cur.fetchone()
    assert row["n"] == 1 and row["p"] == 2


def test_parry_bracket_storage(conn):
    from algorank_ingest import db as adb
    from algorank_ingest.parry.ingest import ParryIngest

    tid = adb.upsert(conn, "tournament", {"source": "parry", "external_id": "pt1"})
    eid = adb.upsert(conn, "event", {"source": "parry", "external_id": "pe1", "tournament_id": tid})
    ing = ParryIngest(_mk_cfg(), conn)
    ing.character_map = {
        "char-uuid-fox": adb.upsert(conn, "game_character", {"source": "parry", "external_id": "char-uuid-fox", "name": "Fox"}),
        "char-uuid-marth": adb.upsert(conn, "game_character", {"source": "parry", "external_id": "char-uuid-marth", "name": "Marth"}),
    }
    ing.stage_map = {
        "stage-uuid-bf": adb.upsert(conn, "stage", {"source": "parry", "external_id": "stage-uuid-bf", "name": "Battlefield"}),
    }
    ph = adb.upsert(conn, "phase", {"source": "parry", "external_id": "pp1", "event_id": eid, "name": "Bracket"})

    match = json.loads((FIXTURES / "parry_match.json").read_text())
    bracket = {
        "id": "bracket-uuid-1",
        "name": "Main Bracket",
        "type": "BRACKET_TYPE_DOUBLE_ELIMINATION",
        "state": "BRACKET_STATE_COMPLETED",
        "index": 0,
        "rounds": [{"number": 2, "winners_side": True, "label": "Winners Semi-Final"}],
        "seeds": [
            {"id": "seed-uuid-1", "seed": 1, "event_entrant": {"id": "ee-1", "event_id": "pe1", "name": "Zain",
                "entrant": {"id": "en-1", "users": [{"id": "user-uuid-a", "gamer_tag": "Zain"}]}}},
            {"id": "seed-uuid-2", "seed": 4, "event_entrant": {"id": "ee-2", "event_id": "pe1", "name": "Cody",
                "entrant": {"id": "en-2", "users": [{"id": "user-uuid-b", "gamer_tag": "Cody"}]}}},
        ],
        "progressions": [
            {"id": "prog-1", "match_id": "match-uuid-2", "target_phase_id": "next-phase",
             "origin_placement": 1, "match_winner": True, "winners_side": True}
        ],
        "matches": [match],
    }
    ing._store_bracket(bracket, eid, ph, entrant_map={})
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("SELECT * FROM sets WHERE source = 'parry'")
        sets = cur.fetchall()
        assert len(sets) == 1
        s = sets[0]
        assert s["winners_next_set_external_id"] == "match-uuid-2"
        assert s["full_round_text"] == "Winners Semi-Final"
        cur.execute("SELECT * FROM set_slot WHERE set_id = %s ORDER BY slot_index", (s["id"],))
        slots = cur.fetchall()
        assert len(slots) == 2 and slots[0]["score"] == 2.0
        assert slots[0]["entrant_id"] is not None
        cur.execute("SELECT * FROM game WHERE set_id = %s", (s["id"],))
        games = cur.fetchall()
        assert len(games) == 1
        assert games[0]["entrant1_score"] == 3.0 and games[0]["entrant2_score"] == 0.0
        assert games[0]["stage_name"] == "Battlefield"
        cur.execute("SELECT count(*) AS n FROM game_slot WHERE game_id = %s", (games[0]["id"],))
        assert cur.fetchone()["n"] == 2
        cur.execute("SELECT value_name FROM game_selection WHERE game_id = %s ORDER BY slot_index", (games[0]["id"],))
        chars = [r["value_name"] for r in cur.fetchall()]
        assert chars == ["Fox", "Marth"]
        cur.execute("SELECT count(*) AS n FROM seed WHERE source = 'parry'")
        assert cur.fetchone()["n"] == 2
        cur.execute("SELECT count(*) AS n FROM progression")
        assert cur.fetchone()["n"] == 1
        # winner resolved via slot placement
        cur.execute("SELECT name FROM entrant WHERE id = %s", (s["winner_entrant_id"],))
        assert cur.fetchone()["name"] == "Zain"


def test_person_soft_merge(conn):
    """Soft merge: person A merged into B, resolvable, reversible."""
    with conn.cursor() as cur:
        cur.execute("INSERT INTO person (display_name) VALUES ('Mango') RETURNING id")
        a = cur.fetchone()["id"]
        cur.execute("INSERT INTO person (display_name) VALUES ('Mang0') RETURNING id")
        b = cur.fetchone()["id"]
        cur.execute("UPDATE person SET merged_into_person_id = %s WHERE id = %s", (b, a))
        cur.execute(
            "INSERT INTO identity_event (kind, person_from_id, person_to_id, reason) VALUES ('merge', %s, %s, 'same player')",
            (a, b),
        )
        cur.execute("SELECT person_root(%s) AS root", (a,))
        assert cur.fetchone()["root"] == b
        cur.execute("SELECT person_root(%s) AS root", (b,))
        assert cur.fetchone()["root"] == b
        # unmerge restores the original person untouched
        cur.execute("UPDATE person SET merged_into_person_id = NULL WHERE id = %s", (a,))
        cur.execute("SELECT person_root(%s) AS root", (a,))
        assert cur.fetchone()["root"] == a
    conn.commit()
