"""Convert parry.gg protobuf-dicts (MessageToDict with proto field names)
into database row dicts. Pure functions, tolerant of absent keys.
"""

from __future__ import annotations

from typing import Any

from ..util import iso_to_dt, utcnow

SOURCE = "parry"


def _slug(t: dict) -> str | None:
    slugs = t.get("slugs") or []
    primary = [s.get("slug") for s in slugs if s.get("type") == "SLUG_TYPE_PRIMARY"]
    if primary:
        return primary[0]
    return slugs[0].get("slug") if slugs else None


def tournament_row(t: dict) -> dict:
    addr = t.get("address") or {}
    return {
        "source": SOURCE,
        "external_id": t.get("id"),
        "slug": _slug(t),
        "name": t.get("name"),
        "short_name": t.get("short_name"),
        "start_at": iso_to_dt(t.get("start_date")),
        "end_at": iso_to_dt(t.get("end_date")),
        "timezone": t.get("time_zone"),
        "created_at_src": iso_to_dt(t.get("created_at")),
        "updated_at_src": iso_to_dt(t.get("updated_at")),
        "state": t.get("state"),
        "is_online": (t.get("location_type") == "LOCATION_TYPE_ONLINE") if t.get("location_type") else None,
        "has_offline_events": t.get("location_type") in ("LOCATION_TYPE_OFFLINE", "LOCATION_TYPE_HYBRID") or None,
        "has_online_events": t.get("location_type") in ("LOCATION_TYPE_ONLINE", "LOCATION_TYPE_HYBRID") or None,
        "num_attendees": t.get("num_attendees"),
        "venue_name": addr.get("premise"),
        "venue_address": t.get("venue_address") or addr.get("formatted_address"),
        "city": addr.get("locality"),
        "addr_state": addr.get("administrative_area_level_1"),
        "country_code": addr.get("country_code"),
        "postal_code": addr.get("postal_code"),
        "lat": addr.get("latitude"),
        "lng": addr.get("longitude"),
        "maps_place_id": addr.get("place_id"),
        "currency": t.get("currency_code"),
        "registration_open_at": iso_to_dt(t.get("registration_start_date")),
        "registration_close_at": iso_to_dt(t.get("registration_end_date")),
        "primary_contact": t.get("admin_contact"),
        "owner_external_id": t.get("owner_id"),
        "images": t.get("images"),
        "raw": {k: v for k, v in t.items() if k != "events"},
        "last_ingested_at": utcnow(),
    }


def event_row(e: dict, tournament_id: int, videogame_id: int | None) -> dict:
    return {
        "source": SOURCE,
        "external_id": e.get("id"),
        "tournament_id": tournament_id,
        "name": e.get("name"),
        "slug": e.get("slug"),
        "state": e.get("state"),
        "videogame_id": videogame_id,
        "start_at": iso_to_dt(e.get("start_date")),
        "created_at_src": iso_to_dt(e.get("created_at")),
        "updated_at_src": iso_to_dt(e.get("updated_at")),
        "registration_open_at": iso_to_dt(e.get("registration_start_date")),
        "registration_close_at": iso_to_dt(e.get("registration_end_date")),
        "is_online": (e.get("location_type") == "LOCATION_TYPE_ONLINE") if e.get("location_type") else None,
        "num_entrants": e.get("entrant_count") or e.get("entrant_size"),
        "entrant_cap": e.get("entrant_cap"),
        "price": e.get("price"),
        "description": e.get("description_md"),
        "raw": {k: v for k, v in e.items() if k != "phases"},
        "last_ingested_at": utcnow(),
    }


def phase_row(p: dict, event_id: int, ordinal: int) -> dict:
    return {
        "source": SOURCE,
        "external_id": p.get("id"),
        "event_id": event_id,
        "name": p.get("name"),
        "ordinal": ordinal,
        "bracket_type": p.get("bracket_type"),
        "num_seeds": p.get("num_entrants"),
        "group_count": p.get("num_brackets"),
        "state": p.get("state"),
        "is_default_entry": p.get("default_entry"),
        "slug": p.get("slug"),
        "raw": {k: v for k, v in p.items() if k != "brackets"},
        "last_ingested_at": utcnow(),
    }


def bracket_to_phase_group_row(b: dict, phase_id: int) -> dict:
    wave = b.get("wave") or {}
    return {
        "source": SOURCE,
        "external_id": b.get("id"),
        "phase_id": phase_id,
        "display_identifier": b.get("name"),
        "name": b.get("name"),
        "slug": b.get("slug"),
        "bracket_type": b.get("type"),
        "state": b.get("state"),
        "bracket_index": b.get("index"),
        "rounds_config": b.get("rounds"),
        "checksum": b.get("checksum"),
        "wave_identifier": wave.get("name"),
        "wave_start_at": iso_to_dt(wave.get("start_at")),
        "wave_end_at": iso_to_dt(wave.get("end_at")),
        "raw": {k: v for k, v in b.items() if k not in ("matches", "seeds", "progressed_seeds")},
        "last_ingested_at": utcnow(),
    }


def user_to_player_account_row(u: dict) -> dict:
    connections = {}
    for acct in u.get("linked_accounts") or []:
        provider = (acct.get("provider") or "").replace("LINKED_ACCOUNT_PROVIDER_", "").lower()
        if provider:
            connections[provider] = {
                "username": acct.get("username"),
                "external_id": acct.get("user_id"),
                "slug": acct.get("slug"),
            }
    name_parts = [u.get("first_name"), u.get("last_name")]
    real_name = " ".join(p for p in name_parts if p) or None
    return {
        "source": SOURCE,
        "external_id": u.get("id"),
        "gamer_tag": u.get("gamer_tag"),
        "prefix": u.get("sponsor_name"),
        "real_name": real_name,
        "first_name": u.get("first_name"),
        "last_name": u.get("last_name"),
        "bio": u.get("bio_md"),
        "pronouns": u.get("pronouns"),
        "city": u.get("location_city"),
        "state": u.get("location_state"),
        "country": u.get("location_country"),
        "avatar_url": u.get("avatar_url"),
        "images": u.get("images"),
        "connections": connections or None,
        "sponsor": u.get("sponsor_name"),
        "is_anonymous": u.get("is_anonymous"),
        "raw": u,
        "last_ingested_at": utcnow(),
    }


def event_entrant_row(ee: dict, event_id: int) -> dict:
    return {
        "source": SOURCE,
        "external_id": ee.get("id"),
        "event_id": event_id,
        "name": ee.get("name"),
        "initial_seed_num": ee.get("seed"),
        "raw": ee,
        "last_ingested_at": utcnow(),
    }


def seed_row(s: dict, phase_group_internal_id: int | None, entrant_internal_id: int | None) -> dict:
    return {
        "source": SOURCE,
        "external_id": s.get("id"),
        "phase_group_id": phase_group_internal_id,
        "entrant_id": entrant_internal_id,
        "seed_num": s.get("seed"),
        "group_seed_num": s.get("bracket_index"),
        "progression": s.get("progression"),
        "raw": s,
        "last_ingested_at": utcnow(),
    }


def round_label_map(bracket: dict) -> dict[tuple[int, bool], str]:
    labels = {}
    for r in bracket.get("rounds") or []:
        labels[(r.get("number"), bool(r.get("winners_side")))] = r.get("label")
    return labels


def match_to_set_row(
    m: dict,
    event_id: int,
    phase_group_internal_id: int | None,
    winner_entrant_internal_id: int | None,
    labels: dict[tuple[int, bool], str],
    stream_internal_id: int | None = None,
) -> dict:
    rnd = m.get("round")
    winners = bool(m.get("winners_side"))
    games = m.get("match_games") or []
    return {
        "source": SOURCE,
        "external_id": m.get("id"),
        "event_id": event_id,
        "phase_group_id": phase_group_internal_id,
        "identifier": m.get("identifier"),
        "round": rnd,
        "full_round_text": labels.get((rnd, winners)),
        "winners_side": winners,
        "is_grand_finals": m.get("grand_finals"),
        "state": m.get("state"),
        "started_at": iso_to_dt(m.get("started_at")),
        "completed_at": iso_to_dt(m.get("ended_at")),
        "updated_at_src": iso_to_dt(m.get("state_updated_at")),
        "winner_entrant_id": winner_entrant_internal_id,
        "total_games": len(games) or None,
        "w_placement": m.get("winners_placement"),
        "l_placement": m.get("losers_placement"),
        "stream_id": stream_internal_id,
        "stream_info": m.get("stream_queue_entry"),
        "prev_set_external_id_1": m.get("prev_match_id_1"),
        "prev_set_external_id_2": m.get("prev_match_id_2"),
        "winners_next_set_external_id": m.get("winners_match_id"),
        "losers_next_set_external_id": m.get("losers_match_id"),
        "raw": m,
        "last_ingested_at": utcnow(),
    }


def match_slot_rows(m: dict, set_internal_id: int, seed_entrant_map: dict[str, int | None]) -> list[dict]:
    rows = []
    for slot in m.get("slots") or []:
        state = slot.get("state")
        rows.append(
            {
                "set_id": set_internal_id,
                "slot_index": slot.get("slot"),
                "entrant_id": seed_entrant_map.get(slot.get("seed_id")),
                "seed_external_id": slot.get("seed_id"),
                "placement": slot.get("placement"),
                "score": slot.get("score"),
                "is_dq": state == "SLOT_STATE_DQ" or None,
                "is_bye": state == "SLOT_STATE_BYE" or None,
                "slot_state": state,
                "raw": slot,
            }
        )
    return rows


def match_winner_seed_id(m: dict) -> str | None:
    for slot in m.get("slots") or []:
        if slot.get("placement") == 1:
            return slot.get("seed_id")
    return None
