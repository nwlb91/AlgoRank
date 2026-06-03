# AlgoRank — Project Plan

This document is built up section-by-section as the project takes shape. It is intended to be the durable reference for design decisions; implementation details that change frequently belong in code or in the README.

## 1. Goals and scope

**Long-term goal:** an algorithmic ranking site for Super Smash Bros. Melee (singles + doubles), eventually hosted at AlgoRank.gg.

**Short-term goal (this iteration):** stand up the data-collection foundation. Specifically:

1. Pull every available detail for every Melee set (singles **and** doubles) from the start.gg GraphQL API for an arbitrary date range.
2. Persist that data into a relational database with a schema rich enough to losslessly reconstruct any tournament's bracket structure.
3. Make it idempotent and re-runnable, so the same date range can be re-ingested without duplicating rows or losing edits.
4. Make the schema source-agnostic so non-start.gg data (manual scrapes, archived results, plain final-placement lists) can be imported later under the same model.
5. Provide a CLI that the user can run locally on a small date window to validate before scaling to the full history of start.gg, and weekly thereafter.

**Explicitly out of scope for this iteration:**
- The web UI / front-end. The data layer comes first.
- The actual ranking algorithm.
- Production hosting / deployment.

## 2. Tech stack

- **Language/runtime:** TypeScript on Node.js. Same language can later power the web app, so we do not need a second stack.
- **DB:** SQLite for local development (zero setup, file-based), with the schema written so it migrates cleanly to PostgreSQL when scaling up. Prisma supports both providers.
- **ORM / migrations:** Prisma. Generates a typed client and handles migrations.
- **GraphQL client:** `graphql-request` — minimal, no React baggage.
- **Rate limiting:** `bottleneck` — token-bucket limiter that handles start.gg's per-minute cap.
- **CLI:** `commander` for argument parsing; entry point in `src/cli/index.ts`.
- **Logging:** `pino` (structured JSON logs; pretty-printed in dev).
- **Config:** `.env` via `dotenv`; `START_GG_TOKEN` is the only required secret for ingestion.

## 3. Data model

The model is designed around **two axes**:

1. **Hierarchy:** Tournament → Event → Phase → PhaseGroup → Set → Game → GameSelection. This mirrors start.gg's structure and is the only way to faithfully reconstruct a bracket.
2. **Source-agnosticism:** every record carries a `source` field (`STARTGG`, `MANUAL`, etc.) and an external-id pair (`sourceId`, plus a globally unique `externalKey = source:sourceId`) so we can ingest from many sources without collisions.

### 3.1 Core entities

- **Tournament** — top-level event series. Fields: name, slug, shortSlug, startAt, endAt, registrationClosesAt, timezone, city, addrState, countryCode, postalCode, lat, lng, venueName, venueAddress, hashtag, currency, isOnline, hasOfflineEvents, hasOnlineEvents, numAttendees, ownerId (user fk), primaryContact, primaryContactType, mapsPlaceId, rules, url, source, sourceId, rawJson.

- **Event** — a single competition inside a tournament (e.g. "Melee Singles"). Fields: tournamentId, name, slug, startAt, state, type (1 = singles, 5 = doubles/teams), videogameId, numEntrants, teamRosterSize, isOnline, prizingInfo, rulesetId, useEventSeeds, ownerId, source, sourceId, rawJson. We **filter to Melee** (videogameId = 1) at ingest time, but the model is game-agnostic so the same DB could later hold other titles.

- **Phase** — an event is split into phases (e.g. "Pools", "Top 64"). Fields: eventId, name, phaseOrder, numSeeds, bracketType, groupCount, isExhibition, state, source, sourceId, rawJson.

- **PhaseGroup** — a single bracket within a phase (e.g. "Pool A1"). Fields: phaseId, displayIdentifier, bracketType, firstRoundTime, state, waveId, numRounds, source, sourceId, rawJson. `Round` info lives here as a denormalized list (start.gg returns rounds per phase group).

- **Entrant** — a participant in an event. For singles, one player; for doubles, one team of two. Fields: eventId, name, isDisqualified, initialSeedNum, finalPlacement, source, sourceId, rawJson.

- **Participant** — links a Player to an Entrant. Fields: entrantId, playerId, gamerTag, prefix, source, sourceId. For doubles, an Entrant has 2 Participants.

- **Player** — a single human's per-tag record on a source. Fields: gamerTag, prefix, userId, source, sourceId. Players merge across tournaments by `userId` when start.gg gives us one; otherwise they are tag-scoped.

- **User** — start.gg's stable cross-tournament identity. Fields: slug, discriminator, name, bio, location, genderPronoun, source, sourceId. Optional — many old players have no User attached.

- **Set** — a head-to-head match. Fields: phaseGroupId, eventId, identifier, displayScore, fullRoundText, round, startedAt, completedAt, state, totalGames, winnerEntrantId, loserEntrantId, isGF, lPlacement, wPlacement, hasErrors, station, streamId, vodUrl, setGamesType, source, sourceId, rawJson.

- **SetSlot** — the two (or more) "slots" in a set. Fields: setId, slotIndex, entrantId, seed, prereqType (`set` / `seed` / `bye`), prereqSetId, prereqPlacement. **This is what makes bracket reconstruction possible** — given every slot's prereqSetId, you can walk the DAG forward from round 1 or backward from grand finals.

- **Game** — a single game within a set. Fields: setId, gameNumber (`orderNum`), winnerEntrantId, state, stageId, entrant1Score, entrant2Score (used for stocks remaining when the source provides it).

- **GameSelection** — a player's character pick for a specific game. Fields: gameId, entrantId, participantId, characterId, selectionType (`character` / `random`), selectionValue, orderNum.

- **Standing** — final placement for an entrant in an event (or in a phase group). Fields: eventId (nullable), phaseGroupId (nullable), entrantId, placement, isFinal, totalPoints, source, sourceId. This is also where we'll record manual "results-list-only" tournaments — a Tournament/Event with Standings but no Sets.

- **Character** — Fields: source, sourceId, name, imageUrl. (Source-scoped because non-start.gg sources may use different IDs.)

- **Stage** — Fields: source, sourceId, name, imageUrl.

- **Videogame** — Fields: source, sourceId, name, displayName, slug. We seed this with `{ source: STARTGG, sourceId: 1 }` for Melee.

### 3.2 Cross-cutting fields on every ingested entity

- `source` (enum: `STARTGG`, `MANUAL`, future: `SMASHWIKI`, `LIQUIPEDIA`, ...)
- `sourceId` (string — start.gg uses numeric IDs, but we store as text for portability)
- A unique constraint on `(source, sourceId)` per table.
- `rawJson` (TEXT) — the full upstream payload as returned by the source. Cheap insurance: if we later realize we need a field we didn't model, we can backfill from `rawJson` without re-hitting the API.
- `firstSeenAt`, `lastSeenAt`, `updatedAt` timestamps for audit.

### 3.3 Reconstructing brackets

Given a `PhaseGroup`, you can rebuild its bracket by:

1. Loading every `Set` in the phase group.
2. For each set, loading its `SetSlot`s.
3. The slot's `prereqType` + `prereqSetId` tells you whether the slot is filled by the winner/loser of an earlier set, by a seed (round 1), or is a bye.
4. `round` (positive = winners, negative = losers) and `fullRoundText` (e.g. "Winners Quarter-Final") provide human-friendly labels.

This is the same data start.gg uses internally, so anything renderable on start.gg is renderable from our DB.

## 4. Ingestion strategy (start.gg)

### 4.1 Constraints

start.gg's GraphQL API has two relevant limits:

- **Request rate:** 80 requests per 60 seconds per token (roughly).
- **Object/complexity per request:** ~1000 "objects" per query. Asking for a tournament with 64 events × 32 entrants × 5 sets in a single query blows past this.

So we **cannot** fetch a tournament in one giant query. We must paginate aggressively and split queries by type.

### 4.2 Discovery → drill-down pipeline

Ingestion runs in waves, each wave persists everything before the next wave starts. This lets a re-run pick up where it left off.

1. **Discover tournaments in date range.** Use `tournaments(query: { filter: { afterDate, beforeDate, videogameIds: [1] } })`, paginated. For each tournament, persist the lightweight tournament row + its events list (Melee events only).

2. **For each Melee event, fetch its phases and phase groups.** Persist them.

3. **For each event, fetch entrants (paginated).** Persist Entrants + Participants + Players + Users. Players/users are upserted by `(source, sourceId)`.

4. **For each phase group, fetch sets (paginated).** Persist Sets + SetSlots. Each set query also pulls `games { id, winnerId, orderNum, stage { id, name }, selections { entrant { id }, character { id, name }, selectionType, selectionValue } }` and per-game scores. Persist Games + GameSelections in the same wave.

5. **For each event, fetch standings (paginated).** Persist Standings.

Each wave checkpoints to the DB — we keep an `IngestionRun` row per execution and an `IngestionCheckpoint` row per (run, tournament, stage) so a crashed run resumes instead of restarting.

### 4.3 Rate limiting and retries

- Wrap every API call in `bottleneck` configured at ~70 req/min (under the 80 cap to leave headroom for retries).
- On HTTP 429 / GraphQL `Throttled` errors: exponential back-off (2s, 4s, 8s, 16s, 32s), max 5 attempts.
- On 5xx: same back-off.
- On `RESPONSE_TOO_LARGE` / object-limit errors: halve page size and retry.

### 4.4 Idempotency

Every upstream entity is upserted on `(source, sourceId)`. A re-run over the same date window is therefore safe and effectively a refresh — fields update in place, `lastSeenAt` advances, and `rawJson` is overwritten with the latest payload. Children (slots, games, selections) are reconciled by deleting any rows whose parent set no longer references them and inserting any new ones; for our purposes this is simpler than diffing.

### 4.5 Modes of operation

The CLI exposes three top-level modes:

- `ingest range --since YYYY-MM-DD --until YYYY-MM-DD` — ingest everything in a date window. This is what you'll run for the first small test.
- `ingest tournament <slug>` — ingest a single tournament by slug. Useful for debugging a specific event.
- `ingest weekly` — ingest the last 8 days (1-day overlap with the previous week to catch late-edited results). This is the cron target once we go to production.

A future `ingest backfill` mode will sweep the entire history of start.gg in monthly chunks, but it's the same code path as `ingest range`.

### 4.6 What is verified vs. discovered at runtime

The following are **verified from the official start.gg developer portal** (the `smashgg/developer-portal` GitHub repo, fetched as raw markdown):

- API endpoint: `https://api.start.gg/gql/alpha`. (`docs/sending-requests.md`)
- Auth: `Authorization: Bearer <token>`. (`docs/authentication.md`)
- Rate limit: **80 requests / 60 seconds**. Error body: `{"success": false, "message": "Rate limit exceeded - api-token"}`. (`docs/rate-limits.md`)
- Object limit: **1000 objects per request**. Error: `{"success": false, "message": "Query complexity too high. A maximum of 1000 objects may be returned by each request. (actual: N)"}`. (`docs/rate-limits.md`)
- Melee videogame id = `1`. (`docs/examples/queries/videogame-id-by-name.md`)
- `tournaments(query: { perPage, page, sortBy, filter: TournamentPageFilter })` with filter fields `videogameIds: [ID]`, `countryCode`, `addrState`, `upcoming`, `past`, `afterDate`, `beforeDate`, `location: { distanceFrom, distance }`. `afterDate`/`beforeDate` are **Timestamp = Unix epoch seconds**. (verified: `tournaments-by-videogame.md`, `tournaments-by-location.md`, schema reference for `TournamentPageFilter`)
- `tournament(slug: $slug) { events(filter: { videogameId: [ID] }) }` — note: filter takes `videogameId` (singular field name, but is an array) when nested in tournament. (`events-by-tournament.md`)
- `event.sets(page, perPage, sortType: STANDARD)` returns `{ pageInfo { total, totalPages }, nodes }`. (`sets-in-event.md`)
- `phaseGroup.sets(page, perPage, sortType: STANDARD)`. (`sets-in-phase-group.md`)
- `phase.phaseGroups(query: { page, perPage })`. (`phase-groups-in-phase.md`)
- `event.entrants(query: { page, perPage })`. (`event-entrants.md`)
- `event.standings(query: { page, perPage })`. (`event-standings.md`)
- `set.games[].{ id, orderNum, winnerId, entrant1Score, entrant2Score, stage { id, name }, selections[] { id, character { id, name } } }`. **Important:** for Smash games "score is equivalent to stocks remaining" per the docs, so `entrant1Score`/`entrant2Score` is what we store as `stocksRemaining`. (`set-game-data.md`)
- `set.slots[].standing.stats.score.{ label, value }` — the per-slot game wins. (`set-score.md`)
- Set IDs sometimes appear as integers and sometimes as strings (e.g. placeholder sets use string ids). We store them as **TEXT**.
- Slot IDs are strings of form `"<setId>-<index>"`. Standing ids may be placeholder strings.
- Tournament `Participant` is point-in-time: gamerTag/prefix at registration, distinct from `Player.gamerTag` (current). `User` has no gamerTag/prefix. (`entrants-by-tournament.md`)

What is **not** verified from the sources reachable in this environment (the official schema reference site is host-blocked) and must therefore be discovered via introspection at runtime:

- The full field list on `Tournament`, `Event`, `Phase`, `PhaseGroup`, `Set`, `Game`, `Entrant`, `Participant`, `Player`, `User`, `Standing`. We know many fields exist (lat/lng/venueName/hashtag on Tournament, vodUrl/station/stream/identifier/fullRoundText/round/lPlacement/wPlacement/isGF/hasPlaceholder on Set, bracketType/firstRoundTime on PhaseGroup, etc.), but to avoid relying on memory we will **introspect the live schema** the first time the CLI runs.

### 4.7 Schema introspection as the first build step

We do not hardcode every field name from memory. Instead:

1. The CLI ships with an `introspect` command that runs the standard GraphQL introspection query against `api.start.gg/gql/alpha` using the user's token, writes the result to `schema/startgg.graphql` (SDL) and `schema/startgg.json` (introspection JSON), both committed to the repo.
2. From those, `graphql-codegen` generates `src/generated/startgg.ts` with TypeScript types for every type and operation.
3. Our queries are written as `.graphql` documents in `src/queries/`. Codegen produces fully-typed request functions. If a field we name doesn't exist, codegen fails — that's our compile-time check that we are referencing the real schema and not a hallucinated one.
4. Each ingestion query is constructed to **select every documented scalar** on each entity. We use a Node.js helper that, given a GraphQL `__Type`, emits `{ all-scalars-of-this-type ...nestedSelections }` so we cannot accidentally drop a field at the document level.

This means the source of truth for "what fields exist" is the live API itself, not this plan or my memory.

## 5. Non-start.gg data import

### 5.1 Why source-agnostic

Lots of historical Melee data lives outside start.gg:
- Pre-2015 events on smashboards / TIO / challonge / smashranks.
- Liquipedia / SmashWiki tournament pages.
- Personal records / community spreadsheets.
- Archived results pages where only the final placement is preserved.

We want all of it under one schema so the eventual ranking algorithm can treat sets equivalently regardless of where they came from.

### 5.2 The import contract

Every importable entity has the same `(source, sourceId, externalKey)` shape used for start.gg. A new source is just a new value of the `source` enum. To add a source:

1. Add a value (e.g. `LIQUIPEDIA`) to the `Source` enum.
2. Write an importer that produces records in our normalized JSON shape (see 5.3) and feeds them through the same upsert layer the start.gg ingester uses.
3. Optionally add a `linkages` step: cross-source player/tournament reconciliation.

Importers live in `src/importers/<source>/`. They never touch the DB directly — they emit normalized records and call into `src/ingest/persist.ts`.

### 5.3 Normalized record shape

A single JSON document that any importer can produce, defined as a Zod schema in `src/importers/types.ts`:

```ts
{
  source: "MANUAL" | "STARTGG" | ...,
  tournament: {
    sourceId: string,
    name, slug?, startAt?, endAt?, country?, state?, city?,
    rawJson?: unknown,
    events: [{
      sourceId: string,
      name, type: "SINGLES" | "DOUBLES",
      videogame: { source, sourceId, name },
      // Optional. If absent, the event is "results-only".
      bracket?: {
        phases: [{ sourceId, name, phaseOrder, bracketType?, phaseGroups: [
          { sourceId, displayIdentifier, sets: [SetRecord] }
        ]}]
      },
      entrants: [{ sourceId, name, participants: [{ gamerTag, prefix?, playerSourceId?, userSourceId? }] }],
      standings?: [{ entrantSourceId, placement, isFinal }]
    }]
  }
}
```

Where `SetRecord` carries everything we know about a set, with most fields optional so partial data is allowed. The persistence layer interprets "missing" fields as "not known", **never** as "no value".

### 5.4 Two common manual-import shapes

- **Full bracket** — the importer can produce sets, slots, games, characters, stages, scores. Goes through the same code path as start.gg.
- **Results-list-only** — the importer produces a Tournament + Event + Standings only. No phases, no sets. The DB happily stores this: standings are not foreign-keyed to any set.

### 5.5 Cross-source identity reconciliation

This is intentionally **out of scope** for the data layer itself; it'll be its own pass that runs over the DB.

We add a `PlayerAlias` table later (`canonicalPlayerId`, `aliasSource`, `aliasSourceId`, `confidence`) that lets us declare "this manual-import 'PPMD' is the same player as start.gg user xyz". Until that pass runs, manual records simply live alongside start.gg records without merging.

## 6. Repository layout

```
AlgoRank/
├── PLAN.md                 — this file
├── README.md               — quickstart for running locally
├── package.json
├── tsconfig.json
├── .env.example
├── prisma/
│   └── schema.prisma       — DB schema
├── schema/
│   ├── startgg.graphql     — introspected SDL (committed)
│   └── startgg.json        — introspection result (committed)
├── codegen.ts              — graphql-codegen config
└── src/
    ├── cli/
    │   └── index.ts        — commander entry point
    ├── config.ts           — env loading
    ├── log.ts              — pino logger
    ├── db.ts               — prisma client singleton
    ├── startgg/
    │   ├── client.ts       — graphql-request wrapper + rate limiter
    │   ├── introspect.ts   — introspection runner
    │   └── queries/        — *.graphql operation documents
    ├── ingest/
    │   ├── range.ts        — date-range orchestrator
    │   ├── tournament.ts   — single-tournament drill-down
    │   ├── persist.ts      — source-agnostic upsert layer
    │   └── checkpoint.ts   — IngestionRun / Checkpoint helpers
    ├── importers/
    │   ├── types.ts        — normalized-record Zod schema
    │   └── manual/         — placeholder for future hand-curated imports
    └── generated/
        └── startgg.ts      — graphql-codegen output (gitignored)
```

## 7. Milestones

1. **M1 — Skeleton (this iteration):** project scaffold, Prisma schema, CLI shell, start.gg client with rate limiting, introspection command, one ingest-range happy path that pulls a small date window end-to-end into SQLite.
2. **M2 — Coverage hardening:** complete every query (games/selections, slot prereqs, phase rounds), add `IngestionRun` checkpointing, retries, `ingest tournament <slug>`.
3. **M3 — Backfill:** monthly-chunked sweep over all start.gg history; switch to PostgreSQL.
4. **M4 — Web UI:** Next.js front-end on top of the same DB.
5. **M5 — Algorithm:** the actual ranking system.

## 8. Open questions to revisit

- **Player merging across tag changes:** start.gg's `User` is the right anchor when present; what's the policy when only a `Player` exists? (Probably: leave them separate until M2 reconciliation pass.)
- **Doubles team identity:** is a "team" of {Mango, Hungrybox} at one tournament the same as the same pair at another? We will key on `(participant.userId set)` when both users are known and otherwise treat each entry as a fresh team.
- **DQs and forfeits:** captured via `Set.state` and `Entrant.isDisqualified`, but we should decide whether DQ'd sets count for ranking. Defer to M5.
- **Race / non-bracket formats:** the `event-standings.md` example shows phaseGroup-level metadata (e.g. kill counts). We persist `Standing.metadata` as JSON to handle these losslessly.

## 9. Curation layer

### 9.1 Why this exists

Raw ingested data is not directly rankable. Real-world problems we need to express:

- Many "Melee Singles" sub-events ought to count; many similarly-named exhibitions, side events, or low-stakes weeklies ought not.
- The same human plays under multiple `Player` rows (different tags, different prefixes, sometimes with a start.gg `User` and sometimes not). Without resolving that, "player X's set history" is incomplete.
- Set results are occasionally reported wrong; we want to override the recorded result without losing the original.

The chosen approach: ranking work happens in small **periods** (yearly, summer, etc.), but the curation decisions made while preparing one period are **global facts**, not period-scoped. Doing 2024 + 2025 yields 2024–25 for free.

### 9.2 Storage model

Three principles, applied to every curation table:

1. **Decisions are global.** A `createdInPeriodId` column tags the period the decision originated in (provenance), but the effect of the decision is unconditional.
2. **Decisions are reversible.** Curation never mutates the source-of-truth row (Event, Set, Player). Override rows store the change; the original stays intact.
3. **Effective state is derived.** Eligibility / result / canonical identity is computed at query time from override rows. No backfill needed when a rule changes.

Tables (Phase 1 — set overrides, event eligibility, and ranking periods landed in this iteration; player merges deferred):

- **`RankingPeriod`** — `(name, kind: yearly|summer|custom, startAt, endAt, videogameId?, eventType?)`. Pure metadata; the lens.
- **`RankingPeriodTournament`** — per-tournament include/exclude override of the period's date-window default. Without a row, scope is determined by the window; a row forces inclusion or exclusion.
- **`EventNameRule`** — `(normalizedName UNIQUE, eligible, createdInPeriodId?, reason?)`. Default-deny; the global event-name whitelist. Normalization (`lib/curation/normalize.ts`) is lowercase + trim + collapse-whitespace, kept deliberately tight.
- **`EventEligibilityOverride`** — `(eventId UNIQUE, eligible, reason, createdInPeriodId?)`. Per-event escape hatch; takes precedence over the name rule.
- **`SetOverride`** — `(setId UNIQUE, kind: EXCLUDE|CORRECT_RESULT, reason, correctedWinnerEntrantId?, correctedDisplayScore?, createdInPeriodId?)`. One row per set; readers compute the effective result via `lib/curation/setResult.ts`.

### 9.3 Workflow

The web app's nav has **Periods** (CRUD + per-period tournament scope) and **Curation** (review queues). The current period is held in a cookie (`lib/curation/currentPeriod.ts`) so review queues are scoped without URL-param plumbing, and each Server Action tags decisions with `createdInPeriodId` automatically.

Per-set and per-event override controls also live on the existing set / event detail pages — no separate "edit mode."

### 9.4 What's intentionally deferred

- **Player merges** — separate table (union-find over reversible merge assertions, materialized to a `canonicalPlayerId` column). Surfaced as a same-name pair review queue. Bootstrap problem: the "competitively relevant" filter for that queue depends on a ranking-independent proxy (peak placement at a large event, set-count threshold) so it isn't blocked by the ranking algorithm not existing yet.
- **Per-period set/event exceptions** — if we ever need "exclude this set from 2025 only," add a periodId column to `SetOverride` and a resolver that prefers period-scoped rows. Not building until a real case demands it.
- **Audit log of override changes** — only the current state is stored; if you change an override later, the prior reason is lost. Add an audit log if it becomes useful.

### 9.5 Where it plugs into ranking (M5)

The ranking pipeline reads:

1. `tournamentsInPeriodWhere(period)` for tournament scope.
2. Events filtered by `resolveEventEligibility(event)` returning `eligible=true`.
3. Sets filtered to those events, with `effectiveSetResult(set, override)` applied; excluded sets dropped, corrected results substituted.
4. Players grouped by `canonicalPlayerId` (once merges land).
