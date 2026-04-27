# AlgoRank

A Super Smash Bros. Melee ranking project. The data foundation (a local-first
ingester that pulls every Melee set from start.gg) and a small browser UI on
top of it are wired up; the actual ranking algorithm comes later.

See [`PLAN.md`](./PLAN.md) for the design rationale.

## Local site

After ingesting some data (see below), browse it in your browser:

```bash
npm run dev
```

Open http://localhost:3000. Pages:

- `/` — tournament list with name + date-range filter.
- `/tournaments/<slug>` — events in that tournament.
- `/events/<id>` — entrants / standings / sets list.
- `/sets/<id>` — slots, games, character + stage selections.
- `/players/<id>` — every set this player has been in.

## Quickstart (local)

Prereqs: Node.js >= 20.

```bash
# 1. Install
npm install

# 2. Configure. Copy the example env and fill in your start.gg API token.
#    Get a token from https://start.gg/admin/profile/developer
cp .env.example .env
$EDITOR .env

# 3. Initialize the local SQLite database.
npx prisma migrate dev

# 4. Pull the start.gg GraphQL schema. This caches the schema to disk so the
#    ingester can build queries that automatically include every scalar field
#    on every type — no hand-maintained field lists.
npm run cli -- introspect

# 5. Ingest a small date window (start with one day to verify it works).
npm run cli -- ingest range --since 2024-09-14 --until 2024-09-14

# 6. Browse what you got.
npx prisma studio
```

## What you'll see in the database

After a successful range ingest, the SQLite DB at `prisma/algorank.db` contains
(among other things):

- `Tournament` — name, slug, dates, location, attendance, organiser, raw payload.
- `Event` — one per Melee event in each tournament (singles + doubles).
- `Phase` / `PhaseGroup` — bracket structure (e.g. "Pools", "Top 64", "Pool A1").
- `Entrant` / `Participant` / `Player` / `User` — who played, with point-in-time tags preserved.
- `Set` — every head-to-head match.
- `SetSlot` — bracket-DAG linkage (which previous set fed each slot).
- `Game` — per-game results (winner, stage, scores = stocks remaining).
- `GameSelection` — character picks per player per game.
- `Standing` — final placements.

Every entity carries `(source, sourceId)` plus the verbatim upstream payload as
`rawJson`, so nothing is ever lost even if we haven't modelled it yet.

## CLI commands

```
algorank introspect
    Fetch and cache the start.gg schema.

algorank ingest range --since YYYY-MM-DD --until YYYY-MM-DD [--per-page N]
    Pull every Melee tournament whose startAt falls in the range and drill
    into events, phases, phase groups, entrants, sets, games, selections, and
    standings.
```

Future commands (see PLAN.md §4.5): `ingest tournament <slug>`,
`ingest weekly`, `ingest backfill`.

## Rate limiting

start.gg limits the API to **80 requests / 60 seconds** and **1000 objects per
request** ([source][rl]). The client throttles to ~70 req/min and retries
transient failures with exponential back-off. If a single query overshoots the
object limit, drop `--per-page` lower.

[rl]: https://github.com/smashgg/developer-portal/blob/master/docs/rate-limits.md

## Project layout

```
prisma/schema.prisma     — DB schema (SQLite locally; PG-ready)
schema/                   — introspected start.gg schema (after running introspect)
src/
  cli/                   — commander entry point
  startgg/               — GraphQL client, introspection, dynamic query builders
  ingest/                — range orchestrator + source-agnostic upsert layer
PLAN.md                  — design doc
```

## Development

```bash
npm run lint     # tsc --noEmit
npm run build    # emit JS to dist/
```
