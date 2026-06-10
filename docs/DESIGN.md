# AlgoRank — Design

Goal: a permanent, complete, continuously updated database of **every recorded
Super Smash Bros. Melee result in history** — singles and doubles — built so
that data never has to be re-ingested because something was missed.

Sources, in order of implementation:

| Phase | Source | Method |
|---|---|---|
| 1 (this repo, done) | start.gg | GraphQL API, full backfill + incremental sync |
| 1 (this repo, done) | parry.gg | gRPC API, full backfill + incremental sync |
| 2 | Liquipedia | wikitext bracket parser + manual confirm UI |
| 2 | Challonge | API ingester + manual confirm UI |
| 2 | paper brackets etc. | manual entry UI |

## 1. Verified API facts

### start.gg
- GraphQL endpoint `https://api.start.gg/gql/alpha`, header `Authorization: Bearer <token>`.
  Tokens come from start.gg → Developer Settings and **expire after 1 year**.
- Rate limit: **80 requests / 60 s**; complexity limit: **max 1000 objects
  returned per request** (nested objects count). Both verified from the
  official docs (smashgg/developer-portal).
- Object hierarchy: Tournament → Event → Phase → PhaseGroup (pool) → Set → Game.
  People: User (account) / Player (persistent tag) / Participant (per
  tournament) / Entrant (per event; a team in doubles).
- Bracket structure is encoded on set slots: `prereqType` / `prereqId` /
  `prereqPlacement` say exactly which set (or seed) feeds each slot — enough
  to rebuild the full bracket DAG including grand final resets.
- Per-game data: `games { winnerId, entrant1Score, entrant2Score, stage,
  selections { selectionType, selectionValue, entrant } }`. The official
  report-set docs state: *"For smash and other platform fighting games, score
  is equivalent to stocks remaining."* So game scores ARE the stocks data.
- Set scores come from `slots.standing.stats.score.value` (a value of **-1
  conventionally means DQ**).
- Melee is `videogameId: 1` (asserted at runtime by name before any ingest).
- The `tournaments` query cannot paginate past 10,000 results, so discovery
  must be windowed by date (see §4).
- User profiles can include name, bio, pronouns, location, birthday and
  connected accounts (twitter/twitch/discord). Some fields are
  permission-gated; see self-healing queries (§5).

### parry.gg
- gRPC over TLS at `api.parry.gg:443`, metadata `x-api-key: <key>`. Official
  Python SDK: `parrygg` (pinned in pyproject). All facts below were taken
  from the SDK's protobuf definitions (v0.1.6).
- Services used: TournamentService (GetTournaments with cursor pagination and
  `TournamentsFilter.event_updated_since` — purpose-built for incremental
  sync; GetTournamentAttendees), EventService (GetEvent with
  `EVENT_VIEW_BRACKET_SUMMARY`, GetEventEntrants, GetEventPlacements),
  PhaseService, BracketService.GetBracket, UserService.GetUsers (per event,
  `include_anonymous_users`), GameService.GetGames, StreamService.
- Hierarchy: Tournament → Event → Phase → Bracket (≈ start.gg phase group) →
  Match → MatchGame.
- The bracket DAG is **explicit and bidirectional** on Match:
  `prev_match_id_1/2`, `winners_match_id`, `losers_match_id`, plus
  `winners_placement` / `losers_placement`, `round`, `winners_side`,
  `grand_finals`.
- MatchGame carries stages, per-slot `score` (stocks), `placement`, state
  (including `SLOT_STATE_DQ` / `SLOT_STATE_BYE`), and per-participant
  **characters** (per user — correct even in doubles).
- Seeds link matches to entrants (`Seed.event_entrant → Entrant → users[]`).
  `Progression` rows describe phase-to-phase movement.
- Users can have **linked accounts including their start.gg account**
  (`LINKED_ACCOUNT_PROVIDER_STARTGG`) — recorded as merge hints (§6).

## 2. Architecture

```
                 ┌────────────────────────────┐
   start.gg ────▶│  algorank backfill / sync  │
   (GraphQL)     │  (Python, stateless;       │       ┌──────────────┐
                 │   all state in Postgres)   │──────▶│  PostgreSQL  │
   parry.gg ────▶│                            │       │  (any host)  │
   (gRPC)        └────────────────────────────┘       └──────────────┘
                        runs anywhere:
              VPS (docker compose) or GitHub Actions cron
```

The ingester is a plain CLI (`algorank`) whose entire progress lives in the
database (`discovery_window`, `event.ingest_status`, `kv_state`,
`sync_run`). Any run can be killed at any moment and rerun later — including
time-boxed chunks (`--max-minutes`) chained by GitHub Actions schedules.

## 3. Data model

One set of tables holds all sources; every sourced row carries
`(source, external_id)` (unique) plus `raw` (JSONB) with the complete API
payload, and an `extra` JSONB for future manual annotations.

| Table | Contents | start.gg | parry.gg |
|---|---|---|---|
| `tournament` | venue, dates, location, owner, images, registration | Tournament | Tournament (+Address) |
| `event` | one competition (Melee Singles, …), type singles/teams | Event | Event |
| `phase` | bracket stage (Pools, Top 64…) | Phase | Phase |
| `phase_group` | a pool/bracket incl. per-round config, waves, seed map | PhaseGroup | Bracket (+Rounds) |
| `sets` | one set: round, timing, score text, placements, vod, stream, station, **DAG pointers both directions** | Set | Match |
| `set_slot` | per-side: entrant, seed, prereq (set/seed/bye), placement, score, DQ | SetSlot+Standing | Slot |
| `game` | per game: winner, **per-side scores (stocks)**, stage, timing | Game | MatchGame |
| `game_slot` | per-side per-game score/placement/state | — | MatchGameSlot |
| `game_selection` | character picks (per entrant / per player) | Selections | participants.characters |
| `entrant` | event entry (team in doubles), seed, final placement | Entrant | EventEntrant |
| `participant` | tournament registration | Participant | TournamentAttendee |
| `player_account` | per-source player identity: tag, prefix, names, bio, birthday, pronouns, location, socials | Player+User | User (+linked accounts) |
| `person` (+`identity_event`) | canonical human; **soft, reversible merges** | — | — |
| `seed`, `progression`, `standing`, `stream`, `videogame`, `game_character`, `stage` | reference & structure data | ✓ | ✓ |

### Bracket reconstruction guarantee
Both encodings are stored:
- backward edges: `set_slot.prereq_type/prereq_external_id/prereq_placement`
  (native on start.gg; derivable on parry from prev ids),
- forward edges: `sets.winners_next_set_external_id` /
  `losers_next_set_external_id` (native on parry; derivable on start.gg by
  inverting prereqs).
Plus per-pool `rounds_config`, `seed_map`, seeds with `progressionSource`,
and `progression` rows — enough to redraw any bracket exactly.

### Identity model (soft merge)
`player_account` rows are immutable facts ("start.gg Player 1000",
"parry user abc"). A `person` row represents the human; accounts point to a
person via `player_account.person_id`; persons can be merged by setting
`merged_into_person_id` (resolved by `person_root()`, reversible by clearing
it). Every operation appends to `identity_event` — nothing ingested is ever
modified or lost. parry→start.gg account links are recorded as
`identity_event kind='link_hint'` to power future merge suggestions.

### Never-re-ingest guarantee
1. `raw` JSONB on every row = the full node as the API returned it.
2. Maximal field requests (see §5) — including fields we don't normalize yet.
3. `schema_snapshot` stores a start.gg introspection dump at backfill time.
4. `api_field_fallback` records any field the API refused, so gaps are known,
   not silent.
If normalization improves later, rows can be rebuilt **from the database**.

## 4. Discovery & backfill (start.gg)

The `tournaments` query is windowed over `startAt` (monthly windows seeded
from `BACKFILL_START`, default 2014-06-01). A window reporting more than
`WINDOW_SPLIT_THRESHOLD` (6000) tournaments splits in half recursively
(min 6h) to stay under the 10k pagination cap. Each window page upserts
tournaments + their Melee events (`ingest_status='pending'`).

Event processing then drains pending events (oldest first): detail+phases+
groups → entrants (full player/user payloads) → per-phase seeds → sets
(slots, games, selections; per-phase-group pagination fallback for events
with >9.5k sets) → standings. Page sizes auto-shrink on complexity errors
and recover gradually.

parry.gg backfill enumerates all tournaments by cursor, keeps those with a
Melee event (matched by game id from GetGames, asserted by name), and walks
event → phases → brackets → matches/games, plus entrants, placements, users,
attendees, and streams.

## 5. Self-healing queries (start.gg)

Queries are built from field-spec trees, not strings. When the live API
rejects a field/argument/variable (`Cannot query field "X"`, `Unknown
argument "X"`, …), the offending name is dropped from the spec, the query
retried, and the drop persisted to `api_field_fallback` (and reapplied on
startup). This makes it safe to request *everything plausibly available*
(birthdays, vod URLs, seed maps, …) without risking the pipeline on schema
drift — and produces an explicit audit trail of anything the API withheld.

## 6. Incremental sync

- start.gg: re-seed/re-scan discovery windows from `watermark − 45d` to
  `now + 400d` (horizon catches newly created tournaments; trailing windows
  are forcibly re-scanned). Events are re-processed when: new; source
  `updatedAt` moved past our last ingest; still live (stale > 6h); or
  completed but inside the 45-day edit window (stale > 2 days). Events
  freeze (`is_final`) 60 days after tournament end; `algorank resync-event`
  un-freezes one explicitly.
- parry.gg: `GetTournaments(event_updated_since = watermark − 45d)` plus the
  same event-level rules.

## 7. Failure handling

- HTTP 429/5xx and gRPC UNAVAILABLE/RESOURCE_EXHAUSTED: exponential backoff
  with jitter, generous retry budgets.
- Per-event errors mark `ingest_status='error'` with the message and an
  attempt counter (capped at 5; the run continues with other events).
- `sync_run` records every run; `algorank status` shows queue depths, recent
  runs, and any field fallbacks.
- Deleted/hidden entities return null nodes — tolerated; previously ingested
  data is retained (history preservation is a feature).

## 8. Known limitations (accepted, documented)

- start.gg standings entries without an entrant (placeholders) are skipped.
- start.gg `Game.images` (rare reported-screenshot images) are not requested
  to keep set pages within complexity limits.
- Forward DAG pointers for start.gg are derivable rather than fetched (the
  API only models backward prereqs).
- If start.gg silently *adds* new fields later, they are not auto-requested;
  adding them to `queries.py` and `resync-event` (or a re-backfill of recent
  windows) picks them up. `schema_snapshot` makes such diffs visible.
- Liquipedia/Challonge/manual sources are Phase 2 (see ROADMAP.md); the
  schema already accommodates them (`source` discriminator, nullable
  external structure, `person` layer).
