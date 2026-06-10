"""GraphQL query specs for start.gg.

Field lists are intentionally maximal: every plausibly useful field is
requested, including some that may be permission-gated (e.g. user birthdays)
or that may not exist on older/newer schema revisions. The self-healing
client drops anything the live API rejects and records the drop in
api_field_fallback, so over-asking is safe and auditable.
"""

from __future__ import annotations

from .gql import QuerySpec

# --------------------------------------------------------------------------
# Shared fragments (plain dicts, deep-copied by QuerySpec)
# --------------------------------------------------------------------------

IMAGES = {"id": None, "type": None, "url": None, "width": None, "height": None, "ratio": None}

USER_FIELDS = {
    "id": None,
    "slug": None,
    "discriminator": None,
    "name": None,            # real name; often null without permission
    "bio": None,
    "birthday": None,        # usually null unless permitted; harmless to ask
    "genderPronoun": None,
    "location": {"id": None, "city": None, "state": None, "country": None, "countryId": None},
    "images": dict(IMAGES),
    "authorizations": {"id": None, "type": None, "externalUsername": None, "externalId": None, "url": None},
}

PLAYER_FIELDS = {"id": None, "gamerTag": None, "prefix": None, "user": dict(USER_FIELDS)}

PARTICIPANT_FIELDS = {
    "id": None,
    "gamerTag": None,
    "prefix": None,
    "verified": None,
    "checkedIn": None,
    "connectedAccounts": None,
    "contactInfo": {
        "id": None, "city": None, "country": None, "countryId": None, "name": None,
        "nameFirst": None, "nameLast": None, "state": None, "stateId": None, "zipcode": None,
    },
    "player": {"id": None, "gamerTag": None, "prefix": None},
    "user": dict(USER_FIELDS),
}

TOURNAMENT_FIELDS = {
    "id": None,
    "name": None,
    "slug": None,
    "shortSlug": None,
    "startAt": None,
    "endAt": None,
    "createdAt": None,
    "updatedAt": None,
    "timezone": None,
    "state": None,
    "venueName": None,
    "venueAddress": None,
    "city": None,
    "addrState": None,
    "countryCode": None,
    "postalCode": None,
    "lat": None,
    "lng": None,
    "mapsPlaceId": None,
    "numAttendees": None,
    "currency": None,
    "isOnline": None,
    "hasOfflineEvents": None,
    "hasOnlineEvents": None,
    "isRegistrationOpen": None,
    "registrationClosesAt": None,
    "eventRegistrationClosesAt": None,
    "teamCreationClosesAt": None,
    "hashtag": None,
    "primaryContact": None,
    "primaryContactType": None,
    "rules": None,
    "url": None,
    "owner": {"id": None, "slug": None, "discriminator": None},
    "images": dict(IMAGES),
    "streams": {
        "id": None, "streamName": None, "streamSource": None, "enabled": None,
        "followerCount": None, "streamGame": None, "streamLogo": None,
        "streamId": None, "isOnline": None, "numSetups": None, "parentStreamId": None,
    },
}

EVENT_SUMMARY_FIELDS = {
    "id": None,
    "name": None,
    "slug": None,
    "state": None,
    "type": None,
    "startAt": None,
    "createdAt": None,
    "updatedAt": None,
    "isOnline": None,
    "numEntrants": None,
    "competitionTier": None,
    "checkInBuffer": None,
    "checkInDuration": None,
    "checkInEnabled": None,
    "entrantSizeMin": None,
    "entrantSizeMax": None,
    "prizingInfo": None,
    "rulesMarkdown": None,
    "teamRosterSize": {"minPlayers": None, "maxPlayers": None},
    "videogame": {"id": None, "name": None, "displayName": None, "slug": None},
}

PHASE_FIELDS = {
    "id": None,
    "name": None,
    "numSeeds": None,
    "bracketType": None,
    "groupCount": None,
    "state": None,
    "phaseOrder": None,
    "isExhibition": None,
}

PHASE_GROUP_FIELDS = {
    "id": None,
    "displayIdentifier": None,
    "state": None,
    "bracketType": None,
    "firstRoundTime": None,
    "startAt": None,
    "tiebreakOrder": None,
    "numRounds": None,
    "seedMap": None,
    "rounds": {"id": None, "bestOf": None, "number": None},
    "wave": {"id": None, "identifier": None, "startAt": None, "endAt": None},
    "phase": {"id": None},
}

GAME_FIELDS = {
    "id": None,
    "orderNum": None,
    "state": None,
    "winnerId": None,
    "entrant1Score": None,
    "entrant2Score": None,
    "stage": {"id": None, "name": None},
    "selections": {
        "id": None,
        "orderNum": None,
        "selectionType": None,
        "selectionValue": None,
        "entrant": {"id": None},
        "participant": {"id": None},
    },
}

SET_FIELDS = {
    "id": None,
    "identifier": None,
    "round": None,
    "fullRoundText": None,
    "state": None,
    "startedAt": None,
    "completedAt": None,
    "createdAt": None,
    "updatedAt": None,
    "startAt": None,
    "winnerId": None,
    "totalGames": None,
    "setGamesType": None,
    "displayScore": None,
    "lPlacement": None,
    "wPlacement": None,
    "hasPlaceholder": None,
    "vodUrl": None,
    "station": {"id": None, "number": None, "clusterNumber": None},
    "stream": {"id": None, "streamName": None, "streamSource": None},
    "phaseGroup": {"id": None},
    "slots": {
        "__args": {"includeByes": "true"},
        "id": None,
        "slotIndex": None,
        "prereqType": None,
        "prereqId": None,
        "prereqPlacement": None,
        "entrant": {"id": None},
        "seed": {"id": None, "seedNum": None},
        "standing": {
            "id": None,
            "placement": None,
            "stats": {"score": {"label": None, "value": None}},
        },
    },
    "games": dict(GAME_FIELDS),
}

ENTRANT_FIELDS = {
    "id": None,
    "name": None,
    "initialSeedNum": None,
    "isDisqualified": None,
    "skill": None,
    "standing": {"id": None, "placement": None},
    "participants": dict(PARTICIPANT_FIELDS),
}

SEED_FIELDS = {
    "id": None,
    "seedNum": None,
    "groupSeedNum": None,
    "isBye": None,
    "placeholderName": None,
    "placement": None,
    "entrant": {"id": None},
    "phaseGroup": {"id": None},
    "players": {"id": None},
    "progressionSource": {
        "id": None,
        "originPlacement": None,
        "originOrder": None,
        "originPhase": {"id": None},
        "originPhaseGroup": {"id": None},
    },
}

STANDING_FIELDS = {
    "id": None,
    "placement": None,
    "isFinal": None,
    "entrant": {"id": None},
    "stats": {"score": {"label": None, "value": None}},
}

# --------------------------------------------------------------------------
# Query builders. Each returns a fresh QuerySpec.
# --------------------------------------------------------------------------


def tournaments_window() -> QuerySpec:
    root = {
        "tournaments": {
            "__args": {
                "query": {
                    "page": "$page",
                    "perPage": "$perPage",
                    "sortBy": '"startAt asc"',
                    "filter": {
                        "videogameIds": "[$videogameId]",
                        "afterDate": "$afterDate",
                        "beforeDate": "$beforeDate",
                    },
                }
            },
            "pageInfo": {"total": None, "totalPages": None},
            "nodes": {
                **TOURNAMENT_FIELDS,
                "events": {
                    "__args": {"filter": {"videogameId": "[$videogameId]"}},
                    **EVENT_SUMMARY_FIELDS,
                },
            },
        }
    }
    return QuerySpec(
        "AlgoRankTournamentsWindow",
        {
            "page": "Int!",
            "perPage": "Int!",
            "videogameId": "ID!",
            "afterDate": "Timestamp!",
            "beforeDate": "Timestamp!",
        },
        root,
    )


def event_detail() -> QuerySpec:
    root = {
        "event": {
            "__args": {"id": "$eventId"},
            **EVENT_SUMMARY_FIELDS,
            "phases": {
                **PHASE_FIELDS,
                "phaseGroups": {
                    "__args": {"query": {"page": "$page", "perPage": "$perPage"}},
                    "pageInfo": {"total": None},
                    "nodes": dict(PHASE_GROUP_FIELDS),
                },
            },
        }
    }
    return QuerySpec(
        "AlgoRankEventDetail",
        {"eventId": "ID!", "page": "Int!", "perPage": "Int!"},
        root,
    )


def event_sets_page() -> QuerySpec:
    root = {
        "event": {
            "__args": {"id": "$eventId"},
            "id": None,
            "sets": {
                "__args": {
                    "page": "$page",
                    "perPage": "$perPage",
                    "sortType": "STANDARD",
                    "filters": {"showByes": "true"},
                },
                "pageInfo": {"total": None, "totalPages": None},
                "nodes": dict(SET_FIELDS),
            },
        }
    }
    return QuerySpec(
        "AlgoRankEventSets", {"eventId": "ID!", "page": "Int!", "perPage": "Int!"}, root
    )


def phase_group_sets_page() -> QuerySpec:
    root = {
        "phaseGroup": {
            "__args": {"id": "$phaseGroupId"},
            "id": None,
            "sets": {
                "__args": {
                    "page": "$page",
                    "perPage": "$perPage",
                    "sortType": "STANDARD",
                    "filters": {"showByes": "true"},
                },
                "pageInfo": {"total": None, "totalPages": None},
                "nodes": dict(SET_FIELDS),
            },
        }
    }
    return QuerySpec(
        "AlgoRankPhaseGroupSets",
        {"phaseGroupId": "ID!", "page": "Int!", "perPage": "Int!"},
        root,
    )


def event_entrants_page() -> QuerySpec:
    root = {
        "event": {
            "__args": {"id": "$eventId"},
            "id": None,
            "entrants": {
                "__args": {"query": {"page": "$page", "perPage": "$perPage"}},
                "pageInfo": {"total": None, "totalPages": None},
                "nodes": dict(ENTRANT_FIELDS),
            },
        }
    }
    return QuerySpec(
        "AlgoRankEventEntrants", {"eventId": "ID!", "page": "Int!", "perPage": "Int!"}, root
    )


def event_standings_page() -> QuerySpec:
    root = {
        "event": {
            "__args": {"id": "$eventId"},
            "id": None,
            "standings": {
                "__args": {"query": {"page": "$page", "perPage": "$perPage"}},
                "pageInfo": {"total": None, "totalPages": None},
                "nodes": dict(STANDING_FIELDS),
            },
        }
    }
    return QuerySpec(
        "AlgoRankEventStandings", {"eventId": "ID!", "page": "Int!", "perPage": "Int!"}, root
    )


def phase_seeds_page() -> QuerySpec:
    root = {
        "phase": {
            "__args": {"id": "$phaseId"},
            "id": None,
            "seeds": {
                "__args": {"query": {"page": "$page", "perPage": "$perPage"}},
                "pageInfo": {"total": None, "totalPages": None},
                "nodes": dict(SEED_FIELDS),
            },
        }
    }
    return QuerySpec(
        "AlgoRankPhaseSeeds", {"phaseId": "ID!", "page": "Int!", "perPage": "Int!"}, root
    )


def videogame_check() -> QuerySpec:
    root = {
        "videogame": {
            "__args": {"id": "$videogameId"},
            "id": None,
            "name": None,
            "displayName": None,
            "slug": None,
            "characters": {"id": None, "name": None},
            "stages": {"id": None, "name": None},
        }
    }
    return QuerySpec("AlgoRankVideogame", {"videogameId": "ID!"}, root)


INTROSPECTION_QUERY = """
query IntrospectionQuery {
  __schema {
    queryType { name }
    types {
      kind
      name
      fields(includeDeprecated: true) {
        name
        args { name type { kind name ofType { kind name ofType { kind name } } } }
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
        isDeprecated
      }
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
      enumValues(includeDeprecated: true) { name isDeprecated }
    }
  }
}
"""
