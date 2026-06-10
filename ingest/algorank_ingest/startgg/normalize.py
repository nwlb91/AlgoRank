"""Convert start.gg GraphQL nodes into database row dicts.

Every function is pure and tolerant of missing keys (fields may have been
dropped by the self-healing layer, or simply be null). The complete node is
always preserved in the row's `raw` column.
"""

from __future__ import annotations

from typing import Any

from ..util import ts_to_dt, utcnow

SOURCE = "startgg"

# start.gg ActivityState integers seen in `state` fields of sets.
SET_STATE_NAMES = {1: "CREATED", 2: "STARTED", 3: "COMPLETED", 4: "READY", 5: "INVALID", 6: "CALLED", 7: "QUEUED"}


def _s(value: Any) -> str | None:
    return None if value is None else str(value)


def tournament_row(node: dict) -> dict:
    owner = node.get("owner") or {}
    return {
        "source": SOURCE,
        "external_id": _s(node.get("id")),
        "slug": node.get("slug"),
        "short_slug": node.get("shortSlug"),
        "name": node.get("name"),
        "start_at": ts_to_dt(node.get("startAt")),
        "end_at": ts_to_dt(node.get("endAt")),
        "timezone": node.get("timezone"),
        "created_at_src": ts_to_dt(node.get("createdAt")),
        "updated_at_src": ts_to_dt(node.get("updatedAt")),
        "state": _s(node.get("state")),
        "is_online": node.get("isOnline"),
        "has_offline_events": node.get("hasOfflineEvents"),
        "has_online_events": node.get("hasOnlineEvents"),
        "num_attendees": node.get("numAttendees"),
        "venue_name": node.get("venueName"),
        "venue_address": node.get("venueAddress"),
        "city": node.get("city"),
        "addr_state": node.get("addrState"),
        "country_code": node.get("countryCode"),
        "postal_code": node.get("postalCode"),
        "lat": node.get("lat"),
        "lng": node.get("lng"),
        "maps_place_id": node.get("mapsPlaceId"),
        "currency": node.get("currency"),
        "registration_close_at": ts_to_dt(node.get("registrationClosesAt")),
        "hashtag": node.get("hashtag"),
        "primary_contact": node.get("primaryContact"),
        "rules": node.get("rules"),
        "url": node.get("url"),
        "owner_external_id": _s(owner.get("id")),
        "owner_info": owner or None,
        "images": node.get("images"),
        "raw": {k: v for k, v in node.items() if k != "events"},
        "last_ingested_at": utcnow(),
    }


def stream_rows(node: dict, tournament_id: int) -> list[dict]:
    rows = []
    for st in node.get("streams") or []:
        if not st or st.get("id") is None:
            continue
        rows.append(
            {
                "source": SOURCE,
                "external_id": _s(st.get("id")),
                "tournament_id": tournament_id,
                "name": st.get("streamName"),
                "platform": _s(st.get("streamSource")),
                "channel": st.get("streamName"),
                "display_name": st.get("streamName"),
                "enabled": st.get("enabled"),
                "raw": st,
                "last_ingested_at": utcnow(),
            }
        )
    return rows


def event_row(node: dict, tournament_id: int, videogame_id: int | None) -> dict:
    roster = node.get("teamRosterSize") or {}
    etype = node.get("type")
    return {
        "source": SOURCE,
        "external_id": _s(node.get("id")),
        "tournament_id": tournament_id,
        "name": node.get("name"),
        "slug": node.get("slug"),
        "state": _s(node.get("state")),
        "event_type": etype,
        "is_teams": (etype == 5) if etype is not None else None,
        "team_min_players": roster.get("minPlayers"),
        "team_max_players": roster.get("maxPlayers"),
        "videogame_id": videogame_id,
        "start_at": ts_to_dt(node.get("startAt")),
        "created_at_src": ts_to_dt(node.get("createdAt")),
        "updated_at_src": ts_to_dt(node.get("updatedAt")),
        "check_in_buffer": node.get("checkInBuffer"),
        "check_in_duration": node.get("checkInDuration"),
        "check_in_enabled": node.get("checkInEnabled"),
        "is_online": node.get("isOnline"),
        "num_entrants": node.get("numEntrants"),
        "competition_tier": node.get("competitionTier"),
        "prizing_info": node.get("prizingInfo"),
        "description": node.get("rulesMarkdown"),
        "raw": node,
        "last_ingested_at": utcnow(),
    }


def phase_row(node: dict, event_id: int) -> dict:
    return {
        "source": SOURCE,
        "external_id": _s(node.get("id")),
        "event_id": event_id,
        "name": node.get("name"),
        "ordinal": node.get("phaseOrder"),
        "bracket_type": _s(node.get("bracketType")),
        "num_seeds": node.get("numSeeds"),
        "group_count": node.get("groupCount"),
        "state": _s(node.get("state")),
        "raw": {k: v for k, v in node.items() if k != "phaseGroups"},
        "last_ingested_at": utcnow(),
    }


def phase_group_row(node: dict, phase_id: int) -> dict:
    wave = node.get("wave") or {}
    return {
        "source": SOURCE,
        "external_id": _s(node.get("id")),
        "phase_id": phase_id,
        "display_identifier": _s(node.get("displayIdentifier")),
        "bracket_type": _s(node.get("bracketType")),
        "state": _s(node.get("state")),
        "first_round_time": ts_to_dt(node.get("firstRoundTime") or node.get("startAt")),
        "tiebreak_order": node.get("tiebreakOrder"),
        "rounds_config": node.get("rounds"),
        "seed_map": node.get("seedMap"),
        "wave_identifier": wave.get("identifier"),
        "wave_start_at": ts_to_dt(wave.get("startAt")),
        "wave_end_at": ts_to_dt(wave.get("endAt")),
        "raw": node,
        "last_ingested_at": utcnow(),
    }


def player_account_row(participant: dict) -> dict | None:
    """Build a player_account row from an entrant participant (Player + User)."""
    player = participant.get("player") or {}
    user = participant.get("user") or {}
    ext_id = player.get("id")
    if ext_id is None:
        return None
    location = user.get("location") or {}
    connections = {}
    for auth in user.get("authorizations") or []:
        if auth and auth.get("type"):
            connections[str(auth["type"]).lower()] = {
                "username": auth.get("externalUsername"),
                "external_id": auth.get("externalId"),
                "url": auth.get("url"),
            }
    return {
        "source": SOURCE,
        "external_id": _s(ext_id),
        "gamer_tag": player.get("gamerTag") or participant.get("gamerTag"),
        "prefix": player.get("prefix") or participant.get("prefix"),
        "user_external_id": _s(user.get("id")),
        "user_slug": user.get("slug"),
        "discriminator": user.get("discriminator"),
        "real_name": user.get("name"),
        "bio": user.get("bio"),
        "birthday": user.get("birthday"),
        "pronouns": user.get("genderPronoun"),
        "city": location.get("city"),
        "state": location.get("state"),
        "country": location.get("country"),
        "images": user.get("images"),
        "connections": connections or None,
        "raw": {"player": player, "user": user},
        "last_ingested_at": utcnow(),
    }


def participant_row(participant: dict, tournament_id: int, player_account_id: int | None) -> dict:
    return {
        "source": SOURCE,
        "external_id": _s(participant.get("id")),
        "tournament_id": tournament_id,
        "player_account_id": player_account_id,
        "gamer_tag": participant.get("gamerTag"),
        "prefix": participant.get("prefix"),
        "verified": participant.get("verified"),
        "checked_in": participant.get("checkedIn"),
        "connected_accounts": participant.get("connectedAccounts"),
        "contact_info": participant.get("contactInfo"),
        "raw": {k: v for k, v in participant.items() if k not in ("user", "player")},
        "last_ingested_at": utcnow(),
    }


def entrant_row(node: dict, event_id: int) -> dict:
    standing = node.get("standing") or {}
    return {
        "source": SOURCE,
        "external_id": _s(node.get("id")),
        "event_id": event_id,
        "name": node.get("name"),
        "initial_seed_num": node.get("initialSeedNum"),
        "is_disqualified": node.get("isDisqualified"),
        "skill": node.get("skill"),
        "final_placement": standing.get("placement"),
        "raw": {k: v for k, v in node.items() if k != "participants"},
        "last_ingested_at": utcnow(),
    }


def seed_row(node: dict, phase_id: int, phase_group_internal_id: int | None, entrant_internal_id: int | None) -> dict:
    prog = node.get("progressionSource") or None
    return {
        "source": SOURCE,
        "external_id": _s(node.get("id")),
        "phase_id": phase_id,
        "phase_group_id": phase_group_internal_id,
        "entrant_id": entrant_internal_id,
        "seed_num": node.get("seedNum"),
        "group_seed_num": node.get("groupSeedNum"),
        "is_bye": node.get("isBye"),
        "placeholder_name": node.get("placeholderName"),
        "placement": node.get("placement"),
        "progression": prog,
        "raw": node,
        "last_ingested_at": utcnow(),
    }


def is_preview_set(node: dict) -> bool:
    sid = node.get("id")
    return isinstance(sid, str) and sid.startswith("preview")


def set_row(node: dict, event_id: int, phase_group_internal_id: int | None, winner_entrant_internal_id: int | None, stream_internal_id: int | None = None) -> dict:
    state = node.get("state")
    station = node.get("station") or {}
    rnd = node.get("round")
    return {
        "source": SOURCE,
        "external_id": _s(node.get("id")),
        "event_id": event_id,
        "phase_group_id": phase_group_internal_id,
        "identifier": node.get("identifier"),
        "round": rnd,
        "full_round_text": node.get("fullRoundText"),
        "winners_side": (rnd > 0) if isinstance(rnd, int) else None,
        "is_grand_finals": ("grand final" in (node.get("fullRoundText") or "").lower()) or None,
        "state": SET_STATE_NAMES.get(state, _s(state)),
        "started_at": ts_to_dt(node.get("startedAt")),
        "completed_at": ts_to_dt(node.get("completedAt")),
        "created_at_src": ts_to_dt(node.get("createdAt")),
        "updated_at_src": ts_to_dt(node.get("updatedAt")),
        "winner_entrant_id": winner_entrant_internal_id,
        "total_games": node.get("totalGames"),
        "set_games_type": node.get("setGamesType"),
        "display_score": node.get("displayScore"),
        "w_placement": node.get("wPlacement"),
        "l_placement": node.get("lPlacement"),
        "vod_url": node.get("vodUrl"),
        "station_number": station.get("number"),
        "stream_id": stream_internal_id,
        "stream_info": node.get("stream"),
        "raw": node,
        "last_ingested_at": utcnow(),
    }


def set_slot_rows(node: dict, set_internal_id: int, entrant_map: dict[str, int]) -> list[dict]:
    rows = []
    for idx, slot in enumerate(node.get("slots") or []):
        if slot is None:
            continue
        entrant = slot.get("entrant") or {}
        seed = slot.get("seed") or {}
        standing = slot.get("standing") or {}
        stats = ((standing.get("stats") or {}).get("score") or {})
        score = stats.get("value")
        rows.append(
            {
                "set_id": set_internal_id,
                "slot_index": slot.get("slotIndex") if slot.get("slotIndex") is not None else idx,
                "entrant_id": entrant_map.get(_s(entrant.get("id"))),
                "seed_external_id": _s(seed.get("id")),
                "seed_num": seed.get("seedNum"),
                "prereq_type": slot.get("prereqType"),
                "prereq_external_id": _s(slot.get("prereqId")),
                "prereq_placement": slot.get("prereqPlacement"),
                "placement": standing.get("placement"),
                "score": score,
                "is_dq": (score == -1) if score is not None else None,
                "is_bye": (slot.get("prereqType") == "bye") or None,
                "raw": slot,
            }
        )
    return rows


def game_rows(
    node: dict,
    set_internal_id: int,
    entrant_map: dict[str, int],
    character_map: dict[str, int],
    stage_map: dict[str, int],
) -> tuple[list[dict], list[list[dict]]]:
    """Returns (game rows, per-game selection rows)."""
    games, selections = [], []
    for idx, g in enumerate(node.get("games") or []):
        if g is None:
            continue
        stage = g.get("stage") or {}
        state = g.get("state")
        games.append(
            {
                "source": SOURCE,
                "external_id": _s(g.get("id")),
                "set_id": set_internal_id,
                "order_num": g.get("orderNum") if g.get("orderNum") is not None else idx + 1,
                "state": SET_STATE_NAMES.get(state, _s(state)),
                "winner_entrant_id": entrant_map.get(_s(g.get("winnerId"))),
                "entrant1_score": g.get("entrant1Score"),
                "entrant2_score": g.get("entrant2Score"),
                "stage_id": stage_map.get(_s(stage.get("id"))),
                "stage_name": stage.get("name"),
                "raw": g,
            }
        )
        sel_rows = []
        for sel in g.get("selections") or []:
            if sel is None:
                continue
            sel_entrant = sel.get("entrant") or {}
            sel_participant = sel.get("participant") or {}
            sel_type = _s(sel.get("selectionType"))
            value = sel.get("selectionValue")
            sel_rows.append(
                {
                    "slot_index": None,
                    "entrant_id": entrant_map.get(_s(sel_entrant.get("id"))),
                    "participant_external_id": _s(sel_participant.get("id")),
                    "selection_type": sel_type,
                    "character_id": character_map.get(_s(value)) if sel_type == "CHARACTER" else None,
                    "value_external_id": _s(value),
                    "order_num": sel.get("orderNum"),
                    "raw": sel,
                }
            )
        selections.append(sel_rows)
    return games, selections


def standing_row(node: dict, event_id: int, entrant_internal_id: int | None) -> dict:
    return {
        "source": SOURCE,
        "external_id": _s(node.get("id")),
        "event_id": event_id,
        "entrant_id": entrant_internal_id,
        "container_type": "event",
        "placement": node.get("placement"),
        "is_final": node.get("isFinal"),
        "stats": node.get("stats"),
        "raw": node,
        "last_ingested_at": utcnow(),
    }
