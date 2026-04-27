# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AlgoRank is a Super Smash Bros. Melee tournament-data + ranking project. The data foundation (start.gg ingester) and a Next.js browser UI are wired up; the actual ranking algorithm is far-future work. Currently runs locally; eventually hosted at AlgoRank.gg.

`PLAN.md` is the durable design doc — read it before making architectural changes.

## Common commands

```bash
# CLI / ingestion
npm run cli -- <subcommand>             # general entry point
npm run cli -- introspect               # cache start.gg schema → schema/startgg.{json,graphql}
npm run cli -- ingest range --since YYYY-MM-DD --until YYYY-MM-DD [--per-page N] [--force]

# Web UI (reads the same SQLite DB)
npm run dev                              # Next.js dev server, http://localhost:3000
npm run build                            # next build
npm run start                            # next start

# Database
npx prisma migrate dev [--name <name>]   # apply migrations / create new one from schema diff
npx prisma migrate reset --force         # wipe local DB + re-apply all migrations
npx prisma studio                        # browser DB explorer
npx prisma generate                      # regenerate Prisma client (after schema edits)

# Type-check (no test runner currently)
npm run lint                             # = tsc --noEmit (covers both CLI and Next pages)
```

`.env` must have `START_GG_TOKEN` and `DATABASE_URL="file:./algorank.db"`. Note that Prisma resolves the DB path **relative to `prisma/schema.prisma`**, so `./algorank.db` lives at `prisma/algorank.db`.

## Architecture

### The two halves of the codebase share one DB and one tsconfig

- **`src/`** — Node CLI for ingestion. Run via `tsx`. Module: ESNext, but written ESM-style with `.js` import suffixes.
- **`app/` + `lib/`** — Next.js App Router site. Server components hit Prisma directly; no API layer.
- One root `tsconfig.json` (`module: ESNext`, `moduleResolution: Bundler`, `jsx: preserve`) covers both. Don't split it.

### Ingestion pipeline (`src/ingest/range.ts`)

1. **Discovery** — cursor-paginates the tournaments query by `startAt`, advancing the cursor to the max `startAt` seen so far. A per-run `seenSourceIds` set dedupes ties at the cursor boundary. **Do not page-paginate this query** — start.gg refuses any tournaments query that would return entries past the 10,000th (raises `StartGgPaginationCapError`).
2. **Per-event drill-down** — for each event: phases + phaseGroups (one shot), entrants (paged), standings (paged), then sets per phase group with games + selections + slots.
3. **Resumption** — `Event.ingestionCompletedAt` is set when an event finishes its drill-down without throwing. Re-runs skip events with a non-null marker. `--force` overrides.
4. **Idempotency** — every entity upserts on `(source, sourceId)` (or a natural compound key for child rows; see below). Re-running over the same window is safe.

### start.gg client (`src/startgg/`)

- **Rate-limited** to ~70 req/min via `bottleneck` (under start.gg's documented 80/60s cap). Exponential back-off retries on transient failures only.
- **Distinct error classes** in `client.ts`:
  - `StartGgRateLimitError` — transient, retried.
  - `StartGgComplexityError` — surfaced to caller; orchestrator halves page sizes and retries.
  - `StartGgPaginationCapError` — terminal (10K-entry cap). Caller must change the query, not retry.
- **Partial-success handling** — start.gg returns 200 with both `data` and `errors` when a token lacks a field's scope (e.g. `User.email`). The client accepts the data when all errors are scope/permission-related.
- **Schema-driven queries** (`schema.ts` + `queries.ts`) — query builders read the introspected schema (`schema/startgg.json`) and emit selection sets containing every scalar field on each type. Means new fields on start.gg's side flow into the DB without code changes. **Add new queries in this style.** A small allowlist excludes scope-restricted fields (`User.email`, `Participant.email`) — extend it if you discover more.

### Data model (`prisma/schema.prisma`)

- **Source-agnostic.** Every entity carries `(source, sourceId, externalKey, rawJson, firstSeenAt, lastSeenAt)`. Future non-start.gg imports flow through the same persist layer (`src/ingest/persist.ts`) — that's why nothing in the schema assumes start.gg semantics.
- **Hierarchy:** Tournament → Event → Phase → PhaseGroup → Set → Game → GameSelection. Plus Entrant/Participant/Player/User for identity and Standing for placements (Standings deliberately are not foreign-keyed to Sets so results-list-only tournaments fit cleanly).
- **Bracket DAG** is reconstructable from `SetSlot.{prereqType, prereqSourceSetId, prereqPlacement}` + `Set.round`. The bracket viz at `/phase-groups/[id]` uses these to display "P1: winner of #12345" prereq labels.
- **Natural compound keys for child upserts.** `Game` upserts on `(setId, orderNum)` and `SetSlot` on `(setId, slotIndex)` — start.gg sometimes mints new ids for the same logical row, so the source ID is mutable metadata, not identity.

### Web UI (`app/`)

- App Router server components only — no client-side state, no API routes.
- Pages are intentionally information-dense and minimally styled. Plain CSS in `app/globals.css`, dark theme.
- Server components import Prisma from `lib/db.ts` (singleton cached on `globalThis` to survive Next dev hot reload).
- Bracket viz (`app/phase-groups/[id]/page.tsx`) renders columns by `Set.round` (positive = winners side, negative = losers side); within each column, sets are sorted by natural-numeric order on `identifier`. **No SVG connecting lines** — prereq pointer labels carry the same correctness signal with less rendering work.

## Working preferences

- **Authoritative documentation over memory.** When details about start.gg's API are needed, fetch them from `github.com/smashgg/developer-portal` (raw markdown is reachable; the rendered docs site at `developer.start.gg` and the schema mirror at `smashgg-schema.netlify.app` are host-blocked from sandboxed environments). Schema specifics come from the live introspection cached at `schema/startgg.json`.
- **`PLAN.md` is appended to with the `Edit` tool**, section by section. Don't `Write` it whole.
- **Finish the in-flight task before pivoting.** If a new instruction arrives mid-tool-call, complete the current task, then address the new message.
- **Don't relitigate settled design decisions.** Source-agnostic schema, schema-driven queries, cursor pagination by `startAt`, natural compound keys for `Game`/`SetSlot`, `ingestionCompletedAt` for resumption — all chosen deliberately.

## Branch + push policy

- All work goes on `claude/create-algorank-website-KwZf1`. Never push to `main` without explicit permission.
- Commits use conventional-ish messages, multi-line, focused on the **why**. See `git log --oneline` for tone.
- Before pushing, run `npm run lint` and (for ingestion changes) sanity-check that the Prisma migration applies cleanly.

## Common gotchas

- **Sparse `Event.id` values after re-runs.** SQLite + Prisma's `ON CONFLICT DO UPDATE` advances the autoincrement counter even on UPDATE. Benign — IDs work fine, just non-dense. Don't try to "fix" by renumbering.
- **start.gg `state` field comes back as a string at the event level (`"COMPLETED"`) and an int at the phase-group level (`3`).** Persisted columns are `Int?` and currently coerce to `null` for string values. If you need to filter on event state, normalize at the persist boundary.
- **Tournament `lat`/`lng` and many other fields are not always returned**; the schema-driven selection asks for everything documented, but `rawJson` is the safety net for anything not modelled at the column level.
- **The introspected schema is committed.** Re-running `algorank introspect` updates `schema/startgg.{json,graphql}` if start.gg's API changes; queries that reference removed fields will fail at `requireField` checks before any network call.
