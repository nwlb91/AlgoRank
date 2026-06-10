# AlgoRank — Roadmap

## Phase 1 — API ingestion (this repo, built)
- [x] Unified Postgres schema with raw-payload retention and soft-merge
      identity layer
- [x] start.gg backfill + incremental sync (self-healing queries)
- [x] parry.gg backfill + incremental sync
- [x] Resumable/chunked execution, Docker + GitHub Actions deployments
- [ ] Run the backfill in production and spot-check against known results
      (e.g. Genesis, Big House, GOML brackets)

## Phase 2 — Manual & semi-automatic ingestion (next)

A small admin web app (proposed: FastAPI + Jinja/htmx, co-hosted on the same
VPS behind Caddy with a single admin login; stays in this repo under `admin/`).
The schema is already prepared: manual rows use `source='manual'` /
`'liquipedia'` / `'challonge'` with the same tables, and the `extra` JSONB
column carries annotations (e.g. "entered from photo of paper bracket").

1. **CRUD forms** for tournaments → events → phases/groups → sets/games →
   entrants/players, optimized for fast keyboard entry while reading a
   source document; per-row provenance notes.
2. **Liquipedia importer**: paste a tournament page's wikitext (or fetch via
   the MediaWiki API — respecting Liquipedia's API terms: identify with a
   proper User-Agent, ≥2 s between requests, CC-BY-SA attribution stored per
   imported tournament). Parser handles both legacy bracket templates
   ({{8SEBracket}}, {{16DEBracket}}, …) and modern Match2 markup
   ({{Bracket|Bracket/8U8L1D…|R1M1=…}} with {{1v1Opponent}}/{{Map}} children),
   producing a **preview render of the reconstructed bracket** (rounds,
   sets, scores, characters where present) that you confirm or correct
   before it is committed. Player names link/auto-suggest against
   `player_account` (creating `source='liquipedia'` accounts keyed by the
   player page name).
3. **Challonge importer**: given a bracket URL/slug + your Challonge API key,
   pull `tournaments/{id}` + `participants` + `matches` (the v1 API exposes
   `player1_prereq_match_id`/`player2_prereq_match_id`, preserving the DAG),
   same preview-confirm flow, `source='challonge'`.
4. **Player merge tool**: search/filter accounts; side-by-side compare;
   one-click merge into a `person` (creating it on demand) with reason;
   undo button (un-merge) — all writes go through `identity_event`, ingested
   rows are never mutated. Surfaced suggestions: parry↔start.gg
   `link_hint`s, exact tag+region matches, shared connected socials.

## Phase 3 — Public site & API
- Read-only REST/GraphQL API + website (tournament pages, player pages,
  head-to-heads) on the same VPS; Cloudflare in front.
- Register `algorank.gg` (~$60/yr) and wire DNS/TLS.
- Attribution pages (start.gg/parry.gg ToS, Liquipedia CC-BY-SA).

## Phase 4 — The actual rankings
- Rating algorithms over the unified `person` graph; era-aware (pre-2015
  data quality flags via per-source provenance); published with
  reproducible methodology.

## Deliberately deferred decisions
- Slippi/replay-derived stats: out of scope for results DB v1.
- start.gg Leagues (circuit points): raw tournament/event data already
  covers their constituent events; league standings can be added as a new
  `standing.container_type` later without re-ingesting.
- Full-text search / trigram indexes: add `pg_trgm` when the admin UI needs
  fuzzy player search at scale.
