// Query builders for the start.gg API. We construct the query strings at
// runtime from the introspected schema (see ./schema.ts) so that we
// automatically pull every scalar field on every type we touch — no
// memorized field lists, no silent gaps when start.gg adds fields.
//
// The structure (which connections to traverse, which arguments to pass) is
// fixed here, but the leaf field selection is generated.

import { selectScalars, requireField, resolveFieldTypeName } from "./schema.js";

function block(typeName: string, indent: string): string {
  return selectScalars(typeName, indent);
}

function blockOf(parentType: string, fieldName: string, indent: string): string {
  const t = resolveFieldTypeName(parentType, fieldName);
  return selectScalars(t, indent);
}

/** Discover Melee tournaments in [afterDate, beforeDate] (Unix seconds). */
export function buildTournamentsByDateQuery(): string {
  // Verified field paths used here:
  //   tournaments(query: { ... afterDate beforeDate videogameIds })  -> docs/examples
  //   tournament.events(filter: { videogameId: [ID] })               -> docs/examples
  requireField("Query", "tournaments");
  requireField("Tournament", "events");
  return /* GraphQL */ `
    query TournamentsByDate(
      $videogameIds: [ID]!
      $afterDate: Timestamp
      $beforeDate: Timestamp
      $page: Int!
      $perPage: Int!
    ) {
      tournaments(
        query: {
          perPage: $perPage
          page: $page
          sortBy: "startAt asc"
          filter: {
            videogameIds: $videogameIds
            afterDate: $afterDate
            beforeDate: $beforeDate
          }
        }
      ) {
        pageInfo { total totalPages }
        nodes {
${block("Tournament", "          ")}
          events(filter: { videogameId: $videogameIds }) {
${block("Event", "            ")}
            videogame {
${block("Videogame", "              ")}
            }
          }
        }
      }
    }
  `;
}

/** Pull phases + phaseGroups + entrants + standings for one event. */
export function buildEventDetailsQuery(): string {
  requireField("Query", "event");
  requireField("Event", "phases");
  requireField("Phase", "phaseGroups");
  requireField("Event", "entrants");
  requireField("Event", "standings");
  return /* GraphQL */ `
    query EventDetails(
      $eventId: ID!
      $entrantsPage: Int!
      $entrantsPerPage: Int!
      $standingsPage: Int!
      $standingsPerPage: Int!
      $phaseGroupsPerPage: Int!
    ) {
      event(id: $eventId) {
${block("Event", "        ")}
        videogame {
${block("Videogame", "          ")}
        }
        phases {
${block("Phase", "          ")}
          phaseGroups(query: { perPage: $phaseGroupsPerPage, page: 1 }) {
            pageInfo { total totalPages }
            nodes {
${block("PhaseGroup", "              ")}
            }
          }
        }
        entrants(query: { page: $entrantsPage, perPage: $entrantsPerPage }) {
          pageInfo { total totalPages }
          nodes {
${block("Entrant", "            ")}
            seeds { seedNum }
            participants {
${block("Participant", "              ")}
              player {
${block("Player", "                ")}
                user {
${block("User", "                  ")}
                }
              }
              user {
${block("User", "                ")}
              }
            }
          }
        }
        standings(query: { page: $standingsPage, perPage: $standingsPerPage }) {
          pageInfo { total totalPages }
          nodes {
${block("Standing", "            ")}
            entrant { id }
          }
        }
      }
    }
  `;
}

/** All sets in one phase group, with full game / selection / slot detail. */
export function buildPhaseGroupSetsQuery(): string {
  requireField("Query", "phaseGroup");
  requireField("PhaseGroup", "sets");
  requireField("Set", "slots");
  requireField("Set", "games");
  return /* GraphQL */ `
    query PhaseGroupSets($phaseGroupId: ID!, $page: Int!, $perPage: Int!) {
      phaseGroup(id: $phaseGroupId) {
        id
        sets(page: $page, perPage: $perPage, sortType: STANDARD) {
          pageInfo { total totalPages }
          nodes {
${block("Set", "            ")}
            slots {
${blockOf("Set", "slots", "              ")}
              entrant { id }
              standing {
                id
                placement
                stats { score { label value } }
              }
            }
            games {
${blockOf("Set", "games", "              ")}
              stage {
${blockOf("Game", "stage", "                ")}
              }
              selections {
${blockOf("Game", "selections", "                ")}
                entrant { id }
                participant { id }
                character {
${blockOf("GameSelection", "character", "                  ")}
                }
              }
            }
          }
        }
      }
    }
  `;
}
