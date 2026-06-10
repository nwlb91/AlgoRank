import json
from pathlib import Path

from algorank_ingest.startgg import normalize as nz

FIXTURES = Path(__file__).parent / "fixtures"
SET_NODE = json.loads((FIXTURES / "startgg_set_node.json").read_text())


def test_set_row():
    entrant_map = {"4863001": 11, "4863002": 22}
    row = nz.set_row(SET_NODE, event_id=5, phase_group_internal_id=9, winner_entrant_internal_id=11)
    assert row["source"] == "startgg"
    assert row["external_id"] == "60086798"
    assert row["round"] == -4
    assert row["winners_side"] is False
    assert row["full_round_text"] == "Losers Quarter-Final"
    assert row["state"] == "COMPLETED"
    assert row["winner_entrant_id"] == 11
    assert row["w_placement"] == 4 and row["l_placement"] == 5
    assert row["vod_url"].startswith("https://twitch.tv")
    assert row["station_number"] == 4
    assert row["completed_at"] is not None and row["completed_at"].year == 2019
    assert row["raw"]["identifier"] == "K"

    slots = nz.set_slot_rows(SET_NODE, 1234, entrant_map)
    assert len(slots) == 2
    s0, s1 = slots
    assert s0["entrant_id"] == 11 and s1["entrant_id"] == 22
    assert s0["prereq_type"] == "set" and s0["prereq_external_id"] == "60086790"
    assert s0["score"] == 3 and s1["score"] == 1
    assert s0["placement"] == 1 and s1["placement"] == 2
    assert s0["is_dq"] is False  # score != -1
    assert s0["seed_num"] == 2


def test_game_rows_with_characters_and_stages():
    entrant_map = {"4863001": 11, "4863002": 22}
    character_map = {"1": 100, "19": 119}  # Fox=1?, Marth=19? (ids from fixture)
    stage_map = {"3": 203, "8": 208}
    games, selections = nz.game_rows(SET_NODE, 1234, entrant_map, character_map, stage_map)
    assert len(games) == 2
    g1, g2 = games
    assert g1["order_num"] == 1 and g1["winner_entrant_id"] == 11
    assert g1["entrant1_score"] == 2 and g1["entrant2_score"] == 0  # stocks remaining
    assert g1["stage_id"] == 203 and g1["stage_name"] == "Battlefield"
    assert g2["winner_entrant_id"] == 22
    sel1 = selections[0]
    assert len(sel1) == 2
    assert sel1[0]["selection_type"] == "CHARACTER"
    assert sel1[0]["character_id"] == 100
    assert sel1[0]["entrant_id"] == 11
    assert sel1[1]["character_id"] == 119


def test_dq_detection():
    node = {
        "id": 1,
        "slots": [
            {"slotIndex": 0, "entrant": {"id": 7}, "standing": {"placement": 1, "stats": {"score": {"value": 0}}}},
            {"slotIndex": 1, "entrant": {"id": 8}, "standing": {"placement": 2, "stats": {"score": {"value": -1}}}},
        ],
    }
    slots = nz.set_slot_rows(node, 1, {"7": 70, "8": 80})
    assert slots[1]["is_dq"] is True


def test_preview_set_detection():
    assert nz.is_preview_set({"id": "preview_123_4"})
    assert not nz.is_preview_set(SET_NODE)


def test_tournament_row():
    node = {
        "id": 12345,
        "name": "The Big House 6",
        "slug": "tournament/big-house-6",
        "startAt": 1475850000,
        "endAt": 1476018000,
        "timezone": "America/Detroit",
        "city": "Whitmore Lake",
        "countryCode": "US",
        "lat": 42.43,
        "lng": -83.74,
        "numAttendees": 1349,
        "owner": {"id": 999, "slug": "user/abc"},
        "events": [{"id": 1}],
    }
    row = nz.tournament_row(node)
    assert row["external_id"] == "12345"
    assert row["start_at"].year == 2016
    assert row["owner_external_id"] == "999"
    assert "events" not in row["raw"]  # events normalized separately


def test_player_account_row():
    part = {
        "id": 555,
        "gamerTag": "Mang0",
        "prefix": "C9",
        "player": {"id": 1000, "gamerTag": "Mang0", "prefix": "C9"},
        "user": {
            "id": 2000,
            "slug": "user/abc123",
            "discriminator": "abc123",
            "name": "Joseph Marquez",
            "birthday": "1991-12-10",
            "genderPronoun": "he/him",
            "location": {"city": "Norwalk", "state": "CA", "country": "United States"},
            "authorizations": [
                {"type": "TWITTER", "externalUsername": "mang0"},
                {"type": "TWITCH", "externalUsername": "mang0"},
            ],
        },
    }
    row = nz.player_account_row(part)
    assert row["external_id"] == "1000"
    assert row["gamer_tag"] == "Mang0"
    assert row["user_external_id"] == "2000"
    assert row["real_name"] == "Joseph Marquez"
    assert row["birthday"] == "1991-12-10"
    assert row["connections"]["twitter"]["username"] == "mang0"
    assert row["city"] == "Norwalk"


def test_player_account_row_no_player():
    assert nz.player_account_row({"id": 1, "user": {}}) is None
