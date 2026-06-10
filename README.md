# AlgoRank

A permanent database of **every recorded Super Smash Bros. Melee result in
history** — singles and doubles — with the complete detail each source
offers: tournaments (dates, venues, locations), events, phases, pools,
seeds, entrants, players (tags, names, socials, locations, birthdays where
public), sets (scores, rounds, placements, VODs, streams, stations,
timestamps), per-game characters, stages and stocks, and the full bracket
structure (which set feeds which) for exact bracket reconstruction.

**Status:** Phase 1 — automated ingestion from the two API-equipped sources,
[start.gg](https://developer.start.gg) (GraphQL) and
[parry.gg](https://developer.parry.gg) (gRPC), with resumable historical
backfill and scheduled incremental sync. Liquipedia/Challonge/manual entry
tooling is Phase 2 — see [docs/ROADMAP.md](docs/ROADMAP.md).

| Doc | Contents |
|---|---|
| [docs/DESIGN.md](docs/DESIGN.md) | architecture, data model, verified API facts, ingestion guarantees |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | hosting (≈$4/mo), deployment, backups, monitoring, troubleshooting |
| [docs/ROADMAP.md](docs/ROADMAP.md) | admin UI, Liquipedia/Challonge importers, player merging, public site |

## Quickstart (local or VPS)

```bash
cp .env.example .env     # add STARTGG_API_TOKEN and PARRY_API_KEY
docker compose up -d db
docker compose run --rm ingester migrate
docker compose run --rm ingester verify       # checks DB + both API credentials
docker compose run -d --rm ingester backfill all   # resumable; safe to interrupt
docker compose run --rm ingester status       # progress at any time
# after backfill completes:
docker compose --profile sync up -d sync      # keep up to date forever (6h loop)
```

Without Docker: `pip install ./ingest` then use the `algorank` CLI directly
(`migrate`, `verify`, `backfill`, `sync`, `status`, `resync-event`).

## Cloud deployment

Two supported modes (details in [docs/OPERATIONS.md](docs/OPERATIONS.md)):

1. **A ~$4/mo VPS** (Hetzner CX22 or Oracle's free tier) running the compose
   stack above — recommended; the eventual `algorank.gg` site can live on
   the same box.
2. **GitHub Actions** (workflows included): set repo secrets `DATABASE_URL`,
   `STARTGG_API_TOKEN`, `PARRY_API_KEY`; flip repo variable
   `BACKFILL_ENABLED=true` to chain 6-hourly backfill chunks against any
   hosted Postgres, then `SYNC_ENABLED=true` for steady-state sync.

The start.gg backfill is rate-limit-bound (80 req/min) and takes on the
order of 1–2 weeks of unattended crawling; every run resumes from database
checkpoints.

## Design highlights

- **Never re-ingest:** every row stores the source's complete raw payload
  (JSONB); queries request every plausibly available field and self-heal
  (with an audit table) when the API refuses one; a start.gg schema
  introspection snapshot is stored with each backfill.
- **Bracket-exact:** both backward (`prereq`) and forward
  (winners/losers-next) set pointers, seeds, progressions, per-round
  configs and seed maps are kept.
- **Identity without destruction:** per-source `player_account` rows are
  immutable; canonical `person` rows support soft, fully reversible merges
  with an append-only `identity_event` audit log (parry→start.gg account
  links are pre-recorded as merge hints).
- **Stocks data:** start.gg documents per-game score as "stocks remaining"
  for platform fighters; both sources' per-game scores, characters and
  stages are normalized into `game` / `game_slot` / `game_selection`.

## Repository layout

```
db/migrations/        SQL schema (raw-retaining, multi-source, soft-merge identity)
ingest/               Python package + tests ("algorank" CLI)
  algorank_ingest/
    startgg/          GraphQL client (self-healing), queries, normalize, orchestrator
    parry/            gRPC client, normalize, orchestrator
.github/workflows/    ci.yml, backfill.yml, sync.yml
docker-compose.yml    Postgres + ingester + sync loop
docs/                 DESIGN / OPERATIONS / ROADMAP
```

## Development

```bash
pip install -e "./ingest[dev]"
python -m pytest ingest            # unit tests
# integration tests against a disposable Postgres:
ALGORANK_TEST_DATABASE_URL=postgresql://... python -m pytest ingest
```
