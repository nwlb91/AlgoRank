#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();
program
  .name("algorank")
  .description("AlgoRank — Melee data layer CLI")
  .version("0.0.1");

program
  .command("introspect")
  .description("Fetch the start.gg GraphQL schema (writes schema/startgg.{graphql,json})")
  .action(async () => {
    const { introspectAndWrite } = await import("../startgg/introspect.js");
    const { log } = await import("../log.js");
    try {
      await introspectAndWrite();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "introspection failed");
      process.exitCode = 1;
    }
  });

const ingest = program
  .command("ingest")
  .description("Pull data from start.gg into the local database");

ingest
  .command("range")
  .description("Ingest every Melee tournament whose startAt falls in [--since, --until]")
  .requiredOption("--since <YYYY-MM-DD>", "inclusive lower bound (UTC)")
  .requiredOption("--until <YYYY-MM-DD>", "inclusive upper bound (UTC)")
  .option("--per-page <n>", "tournaments per page (default 25)", (v) => parseInt(v, 10))
  .option("--force", "re-process events that were previously ingested fully", false)
  .action(async (opts: { since: string; until: string; perPage?: number; force?: boolean }) => {
    const { ingestRange } = await import("../ingest/range.js");
    const { log } = await import("../log.js");
    const after = parseDateUtc(opts.since);
    const before = parseDateUtc(opts.until, { endOfDay: true });
    if (Number.isNaN(after) || Number.isNaN(before)) {
      log.error({ since: opts.since, until: opts.until }, "invalid date(s); expected YYYY-MM-DD");
      process.exitCode = 1;
      return;
    }
    if (after >= before) {
      log.error({ since: opts.since, until: opts.until }, "--since must be before --until");
      process.exitCode = 1;
      return;
    }
    try {
      await ingestRange({
        afterDate: Math.floor(after / 1000),
        beforeDate: Math.floor(before / 1000),
        ...(opts.perPage !== undefined ? { perPage: opts.perPage } : {}),
        ...(opts.force ? { force: true } : {}),
      });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "ingest range failed");
      process.exitCode = 1;
    }
  });

const parrygg = program
  .command("parrygg")
  .description("Pull data from parry.gg into the local database");

parrygg
  .command("discover")
  .description(
    "Dry-run: walk parry.gg tournaments, find Melee's game slug, log volume. No DB writes.",
  )
  .option("--page-size <n>", "tournaments per page (default 100)", (v) => parseInt(v, 10))
  .option("--max-pages <n>", "stop after this many pages (default 10000)", (v) => parseInt(v, 10))
  .option("--sample-size <n>", "Melee tournaments to list at end (default 10)", (v) => parseInt(v, 10))
  .action(async (opts: { pageSize?: number; maxPages?: number; sampleSize?: number }) => {
    const { discover } = await import("../parrygg/discover.js");
    const { log } = await import("../log.js");
    try {
      await discover({
        ...(opts.pageSize !== undefined ? { pageSize: opts.pageSize } : {}),
        ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
        ...(opts.sampleSize !== undefined ? { sampleSize: opts.sampleSize } : {}),
      });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "parrygg discover failed");
      process.exitCode = 1;
    }
  });

function parseDateUtc(s: string, opts: { endOfDay?: boolean } = {}): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.NaN;
  const t = Date.parse(`${s}T${opts.endOfDay ? "23:59:59" : "00:00:00"}Z`);
  return t;
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
