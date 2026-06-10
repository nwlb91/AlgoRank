# AlgoRank — Operations

## 0. Cost summary / recommendation

The full start.gg Melee archive is **millions of sets**; with raw payload
retention expect roughly **10–40 GB** in Postgres. That rules out free-tier
managed Postgres (Neon/Supabase free ≈ 0.5 GB). Cheapest sane setups:

| Option | Monthly cost | Notes |
|---|---|---|
| **Hetzner CX22 VPS (recommended)** | ~€3.79 (~$4) | 2 vCPU / 4 GB / 40 GB NVMe. Runs Postgres + ingester + (later) the website. Upgrade to CX32 (€6.80, 80 GB) only if needed. |
| Oracle Cloud "Always Free" ARM VM | $0 | 4 OCPU / 24 GB RAM / up to 200 GB. Genuinely free but signup/capacity can be flaky. Same setup steps. |
| GitHub Actions (compute) + managed Postgres | DB cost dominates ($19–25/mo at this size) | Only worth it if you strongly prefer zero servers. |
| Backups: Backblaze B2 or Cloudflare R2 | $0 | 10 GB free tier; a compressed `pg_dump` of this dataset is a few GB. |
| Domain `algorank.gg` (Phase 3) | ~$50–90/yr | .gg is a premium TLD. Defer until the public site exists; `.net/.org` are ~$12/yr if cost matters. |

**Recommended:** Hetzner VPS running `docker compose` (database + ingester +
sync loop). GitHub Actions workflows are included too and work with any
reachable Postgres — useful if you'd rather not SSH anywhere.

API usage is free on both start.gg and parry.gg (you only need accounts to
create credentials).

## 1. Credentials

1. **start.gg token**: start.gg → your profile → *Developer Settings* →
   *Create new token*. ⚠ Tokens **expire after 1 year** — calendar a rotation.
2. **parry.gg API key**: parry.gg account → developer/API settings → create
   key (sent as `x-api-key`).

## 2. VPS deployment (recommended path)

```bash
# on a fresh Ubuntu 24.04 VPS
apt-get update && apt-get install -y docker.io docker-compose-v2 git
git clone https://github.com/nwlb91/AlgoRank.git && cd AlgoRank
cp .env.example .env && nano .env        # set POSTGRES_PASSWORD + both API creds

docker compose up -d db
docker compose run --rm ingester migrate
docker compose run --rm ingester verify          # checks DB + both APIs

# full backfill (safe to interrupt/restart any time; resumes automatically)
docker compose run -d --rm ingester backfill all
docker compose run --rm ingester status          # watch progress whenever

# when status shows no pending windows/events, start the forever sync loop:
docker compose --profile sync up -d sync
```

Expected backfill duration: parry.gg finishes in hours; start.gg is
rate-limit-bound — on the order of **1–2 weeks** of continuous polite
crawling for all of Melee history. It needs no supervision; check
`status` occasionally and re-run `backfill` if the container ever died.

## 3. GitHub Actions deployment (alternative)

1. Host Postgres somewhere reachable (managed PG, or the VPS above with the
   port exposed + strong password).
2. Repo → Settings → Secrets and variables → Actions:
   - secrets `DATABASE_URL`, `STARTGG_API_TOKEN`, `PARRY_API_KEY`
   - variable `BACKFILL_ENABLED=true`
3. The **Backfill** workflow then runs a ~5.5 h chunk every 6 hours, resuming
   from the database checkpoint each time, until it logs COMPLETE.
4. Set `BACKFILL_ENABLED=false`, `SYNC_ENABLED=true` — the **Sync** workflow
   keeps the DB current every 6 hours thereafter.

Note: on a private repo, Actions minutes are limited (2,000/mo on Free) —
the start.gg backfill alone needs far more, so either make the repo public,
run the backfill on the VPS, or accept a multi-month backfill. The
*incremental sync* fits comfortably in free private minutes.

## 4. Backups (do this once backfill starts)

```bash
# /etc/cron.d/algorank-backup  (B2 example; rclone remote configured as "b2")
30 9 * * * root docker compose -f /root/AlgoRank/docker-compose.yml exec -T db \
  pg_dump -U algorank -Fc algorank | zstd -9 | \
  rclone rcat b2:algorank-backups/algorank-$(date +\%F).dump.zst
```

Restore: `zstd -d < dump.zst | pg_restore -U algorank -d algorank --clean`.
Keep ~8 dailies + monthlies; prune with `rclone delete --min-age 60d`.

## 5. Monitoring & troubleshooting

- `algorank status` — row counts, queue depths, recent runs, and a warning
  if any API field was rejected (`api_field_fallback` table).
- `sync_run` table — history of every run with status/stats.
- Event stuck in `error`: the message is in `event.ingest_error`; after 5
  attempts it's parked. Fix cause, then
  `algorank resync-event --source startgg --external-id <id>`.
- Rate-limit warnings in logs are normal; the client self-throttles.
- start.gg token expired (HTTP 401): create a new token, update secret/.env.
- Disk: `SELECT pg_size_pretty(pg_database_size('algorank'));` — if nearing
  capacity, VACUUM, then consider the bigger VPS tier.

## 6. Verification queries (sanity)

```sql
-- biggest events ingested
SELECT t.name, e.name, e.num_entrants,
       (SELECT count(*) FROM sets s WHERE s.event_id = e.id) AS sets
FROM event e JOIN tournament t ON t.id = e.tournament_id
ORDER BY e.num_entrants DESC NULLS LAST LIMIT 20;

-- bracket DAG integrity: slots whose prereq set is missing (should be ~0)
SELECT count(*) FROM set_slot sl
JOIN sets s ON s.id = sl.set_id
WHERE sl.prereq_type = 'set'
  AND NOT EXISTS (SELECT 1 FROM sets p
                  WHERE p.source = s.source AND p.external_id = sl.prereq_external_id);

-- character data coverage by year
SELECT date_part('year', s.completed_at) AS yr,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM game g WHERE g.set_id = s.id)) AS sets_with_games,
       count(*) AS sets
FROM sets s GROUP BY 1 ORDER BY 1;
```

## 7. The custom domain (Phase 3 preview)

When the public site exists: register `algorank.gg` (Porkbun/Cloudflare ~$60/yr),
point DNS at the VPS via Cloudflare (free plan: TLS, caching, DDoS),
run the site behind Caddy (automatic HTTPS) on the same box.
Until then nothing needs a domain — the ingester talks outbound only.
