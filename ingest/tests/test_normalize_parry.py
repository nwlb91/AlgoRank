import json
from pathlib import Path

from algorank_ingest.parry import normalize as nz

FIXTURES = Path(__file__).parent / "fixtures"
MATCH = json.loads((FIXTURES / "parry_match.json").read_text())


def test_match_to_set_row():
    labels = {(2, True): "Winners Semi-Final"}
    row = nz.match_to_set_row(MATCH, event_id=5, phase_group_internal_id=9,
                              winner_entrant_internal_id=11, labels=labels)
    assert row["source"] == "parry"
    assert row["external_id"] == "match-uuid-1"
    assert row["round"] == 2
    assert row["winners_side"] is True
    assert row["full_round_text"] == "Winners Semi-Final"
    assert row["state"] == "MATCH_STATE_COMPLETED"
    assert row["prev_set_external_id_1"] == "match-uuid-0a"
    assert row["prev_set_external_id_2"] == "match-uuid-0b"
    assert row["winners_next_set_external_id"] == "match-uuid-2"
    assert row["losers_next_set_external_id"] == "match-uuid-9"
    assert row["l_placement"] == 7
    assert row["completed_at"] is not None and row["completed_at"].year == 2025
    assert row["total_games"] == 1


def test_match_slot_rows_and_winner():
    seed_map = {"seed-uuid-1": 101, "seed-uuid-2": 102}
    slots = nz.match_slot_rows(MATCH, 77, seed_map)
    assert len(slots) == 2
    assert slots[0]["entrant_id"] == 101 and slots[0]["slot_index"] == 0
    assert slots[0]["score"] == 2.0 and slots[0]["placement"] == 1
    assert slots[1]["score"] == 1.0
    assert nz.match_winner_seed_id(MATCH) == "seed-uuid-1"


def test_dq_and_bye_flags():
    m = {
        "slots": [
            {"slot": 0, "seed_id": "a", "state": "SLOT_STATE_DQ"},
            {"slot": 1, "seed_id": "b", "state": "SLOT_STATE_BYE"},
        ]
    }
    slots = nz.match_slot_rows(m, 1, {})
    assert slots[0]["is_dq"] is True
    assert slots[1]["is_bye"] is True


def test_round_label_map():
    bracket = {"rounds": [
        {"number": 1, "winners_side": True, "label": "Winners Round 1"},
        {"number": 1, "winners_side": False, "label": "Losers Round 1"},
    ]}
    labels = nz.round_label_map(bracket)
    assert labels[(1, True)] == "Winners Round 1"
    assert labels[(1, False)] == "Losers Round 1"


def test_tournament_row():
    t = {
        "id": "t-uuid",
        "name": "Get On My Level 2025",
        "short_name": "GOML",
        "start_date": "2025-05-16T14:00:00Z",
        "end_date": "2025-05-18T23:00:00Z",
        "time_zone": "America/Toronto",
        "state": "TOURNAMENT_STATE_COMPLETED",
        "location_type": "LOCATION_TYPE_OFFLINE",
        "num_attendees": 800,
        "slugs": [
            {"slug": "goml-2025-old", "type": "SLUG_TYPE_OUTDATED"},
            {"slug": "goml-2025", "type": "SLUG_TYPE_PRIMARY"}
        ],
        "address": {
            "locality": "Toronto",
            "administrative_area_level_1": "ON",
            "country_code": "CA",
            "latitude": 43.65,
            "longitude": -79.38,
            "formatted_address": "123 Queen St W, Toronto, ON",
            "place_id": "place123"
        },
        "owner_id": "owner-uuid",
        "events": [{"id": "e1"}],
    }
    row = nz.tournament_row(t)
    assert row["external_id"] == "t-uuid"
    assert row["slug"] == "goml-2025"
    assert row["city"] == "Toronto"
    assert row["is_online"] is False
    assert row["start_at"].year == 2025
    assert "events" not in row["raw"]


def test_user_to_player_account_with_startgg_link():
    u = {
        "id": "user-uuid-a",
        "gamer_tag": "Zain",
        "first_name": "Zain",
        "last_name": "Naghmi",
        "pronouns": "he/him",
        "location_country": "United States",
        "linked_accounts": [
            {"provider": "LINKED_ACCOUNT_PROVIDER_STARTGG", "user_id": "ext-sgg-1", "slug": "user/abc"},
            {"provider": "LINKED_ACCOUNT_PROVIDER_DISCORD", "username": "zain#123"},
        ],
        "sponsor_name": "GG",
    }
    row = nz.user_to_player_account_row(u)
    assert row["external_id"] == "user-uuid-a"
    assert row["real_name"] == "Zain Naghmi"
    assert row["connections"]["startgg"]["external_id"] == "ext-sgg-1"
    assert row["connections"]["discord"]["username"] == "zain#123"
    assert row["prefix"] == "GG"
