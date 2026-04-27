// Date-range ingestion: pull every Melee tournament whose startAt falls in
// [afterDate, beforeDate], then drill down into each event for its phases,
// phase groups, entrants, sets, games, selections, and standings.
//
// Pagination + the 1000-object cap force this to be many small requests
// rather than one big one. We checkpoint progress to IngestionCheckpoint so
// a re-run picks up where it left off.

import { gql, StartGgComplexityError } from "../startgg/client.js";
import {
  buildEventDetailsQuery,
  buildPhaseGroupSetsQuery,
  buildTournamentsByDateQuery,
} from "../startgg/queries.js";
import {
  upsertEntrant,
  upsertEvent,
  upsertPhase,
  upsertPhaseGroup,
  upsertSet,
  upsertStanding,
  upsertTournament,
  type EntrantLookup,
} from "./persist.js";
import { Source, MELEE_VIDEOGAME_ID } from "../config.js";
import { prisma } from "../db.js";
import { log } from "../log.js";

interface RangeOpts {
  afterDate: number; // unix seconds, inclusive
  beforeDate: number; // unix seconds, inclusive
  perPage?: number;
  /** Re-process events that were previously marked as fully ingested. */
  force?: boolean;
}

export async function ingestRange(opts: RangeOpts): Promise<void> {
  const perPage = opts.perPage ?? 25;
  const force = opts.force ?? false;

  const run = await prisma.ingestionRun.create({
    data: {
      source: Source.STARTGG,
      mode: "range",
      paramsJson: JSON.stringify(opts),
    },
  });

  try {
    log.info(
      {
        runId: run.id,
        afterDate: new Date(opts.afterDate * 1000).toISOString(),
        beforeDate: new Date(opts.beforeDate * 1000).toISOString(),
      },
      "starting date-range ingestion",
    );

    const tournamentsQuery = buildTournamentsByDateQuery();

    let page = 1;
    let totalPages = 1;
    let totalTournaments = 0;
    do {
      const data = await gql<TournamentsByDateData>(
        tournamentsQuery,
        {
          videogameIds: [MELEE_VIDEOGAME_ID],
          afterDate: opts.afterDate,
          beforeDate: opts.beforeDate,
          page,
          perPage,
        },
        { opName: `tournaments page=${page}` },
      );
      totalPages = data.tournaments?.pageInfo?.totalPages ?? 1;
      const nodes = data.tournaments?.nodes ?? [];
      log.info(
        { runId: run.id, page, totalPages, count: nodes.length, total: data.tournaments?.pageInfo?.total },
        "tournaments page",
      );

      for (const t of nodes) {
        if (!t) continue;
        const tournamentId = await upsertTournament(t as Record<string, unknown>, Source.STARTGG);
        const events = (t.events ?? []) as Array<Record<string, unknown>>;
        for (const e of events) {
          await ingestEvent(e, tournamentId, run.id, force);
          totalTournaments++;
        }
      }

      page++;
    } while (page <= totalPages);

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "succeeded" },
    });
    log.info({ runId: run.id, totalTournaments }, "ingestion complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "failed", errorMessage: message },
    });
    throw err;
  }
}

async function ingestEvent(
  e: Record<string, unknown>,
  tournamentId: number,
  runId: number,
  force: boolean,
): Promise<void> {
  const eventDbId = await upsertEvent(e, tournamentId, Source.STARTGG);
  const eventSourceId = String(e.id);
  const scopeKey = `event:${Source.STARTGG}:${eventSourceId}`;

  if (!force) {
    const existing = await prisma.event.findUnique({
      where: { id: eventDbId },
      select: { ingestionCompletedAt: true },
    });
    if (existing?.ingestionCompletedAt) {
      log.info(
        { eventDbId, eventSourceId, name: e.name, completedAt: existing.ingestionCompletedAt },
        "skipping (already fully ingested; pass --force to re-process)",
      );
      return;
    }
  }

  log.info({ runId, eventDbId, eventSourceId, name: e.name }, "ingesting event");

  // Pull phases / phaseGroups / entrants / standings in chunks. We loop on
  // entrants and standings; phases come back in one shot for typical events.
  const phaseIdByExternal = new Map<string, number>();
  const phaseGroupSourceIds: string[] = [];
  const phaseGroupIdByExternal = new Map<string, number>();
  const entrantIdBySourceId = new Map<string, number>();

  const entrantsLookup: EntrantLookup = {
    bySourceId(id) {
      if (id == null) return null;
      return entrantIdBySourceId.get(String(id)) ?? null;
    },
  };

  const eventDetailsQuery = buildEventDetailsQuery();

  // First call also returns phases + standings + first page of entrants.
  let entrantsPage = 1;
  let entrantsTotalPages = 1;
  let standingsPage = 1;
  let standingsTotalPages = 1;

  // Page sizes auto-shrink when start.gg reports the request as too complex.
  // Initial defaults are conservative; entrants are the heaviest because each
  // node pulls participant -> player -> user (deeply nested).
  let entrantsPerPage = 25;
  let standingsPerPage = 50;
  let phaseGroupsPerPage = 50;
  const MIN_PER_PAGE = 2;

  while (entrantsPage <= entrantsTotalPages || standingsPage <= standingsTotalPages) {
    let data: EventDetailsData | null = null;
    while (data == null) {
      try {
        data = await gql<EventDetailsData>(
          eventDetailsQuery,
          {
            eventId: eventSourceId,
            entrantsPage,
            entrantsPerPage,
            standingsPage,
            standingsPerPage,
            phaseGroupsPerPage,
          },
          {
            opName: `event ${eventSourceId} e=${entrantsPage} s=${standingsPage} pp=${entrantsPerPage}/${standingsPerPage}/${phaseGroupsPerPage}`,
          },
        );
      } catch (e: unknown) {
        if (
          e instanceof StartGgComplexityError &&
          (entrantsPerPage > MIN_PER_PAGE || standingsPerPage > MIN_PER_PAGE || phaseGroupsPerPage > MIN_PER_PAGE)
        ) {
          const next = {
            entrants: Math.max(MIN_PER_PAGE, Math.floor(entrantsPerPage / 2)),
            standings: Math.max(MIN_PER_PAGE, Math.floor(standingsPerPage / 2)),
            phaseGroups: Math.max(MIN_PER_PAGE, Math.floor(phaseGroupsPerPage / 2)),
          };
          log.warn(
            {
              eventSourceId,
              from: { entrantsPerPage, standingsPerPage, phaseGroupsPerPage },
              to: next,
              actual: e.actual,
            },
            "event details too complex; halving page sizes and retrying",
          );
          entrantsPerPage = next.entrants;
          standingsPerPage = next.standings;
          phaseGroupsPerPage = next.phaseGroups;
          continue;
        }
        throw e;
      }
    }

    const ev = data.event;
    if (!ev) break;

    if (entrantsPage === 1) {
      // Persist phases + phase groups (one-shot).
      for (const ph of ev.phases ?? []) {
        if (!ph) continue;
        const phaseDbId = await upsertPhase(ph as Record<string, unknown>, eventDbId, Source.STARTGG);
        phaseIdByExternal.set(String(ph.id), phaseDbId);
        for (const pg of ph.phaseGroups?.nodes ?? []) {
          if (!pg) continue;
          const pgDbId = await upsertPhaseGroup(pg as Record<string, unknown>, phaseDbId, Source.STARTGG);
          phaseGroupIdByExternal.set(String(pg.id), pgDbId);
          phaseGroupSourceIds.push(String(pg.id));
        }
      }
    }

    // Entrants page
    if (entrantsPage <= entrantsTotalPages) {
      const conn = ev.entrants;
      entrantsTotalPages = conn?.pageInfo?.totalPages ?? entrantsTotalPages;
      for (const entrant of conn?.nodes ?? []) {
        if (!entrant) continue;
        const eid = await upsertEntrant(entrant as Record<string, unknown>, eventDbId, Source.STARTGG);
        entrantIdBySourceId.set(String(entrant.id), eid);
      }
      entrantsPage++;
    }

    // Standings page
    if (standingsPage <= standingsTotalPages) {
      const conn = ev.standings;
      standingsTotalPages = conn?.pageInfo?.totalPages ?? standingsTotalPages;
      for (const st of conn?.nodes ?? []) {
        if (!st) continue;
        await upsertStanding(
          st as Record<string, unknown>,
          { eventId: eventDbId },
          entrantsLookup,
          Source.STARTGG,
        );
      }
      standingsPage++;
    }
  }

  await prisma.ingestionCheckpoint.upsert({
    where: { runId_scopeKey_stage: { runId, scopeKey, stage: "phases" } },
    create: { runId, scopeKey, stage: "phases", page: 1, done: true },
    update: { done: true, page: 1 },
  });

  // Now sets per phase group. Sets queries are the heaviest (slots × games ×
  // selections × character), so they hit the 1000-object cap most often.
  // We start optimistic and halve perPage on each StartGgComplexityError,
  // remembering the largest page size that worked for subsequent pages.
  const setsQuery = buildPhaseGroupSetsQuery();
  const SETS_INITIAL_PER_PAGE = 25;
  const SETS_MIN_PER_PAGE = 2;
  for (const pgSourceId of phaseGroupSourceIds) {
    const phaseGroupDbId = phaseGroupIdByExternal.get(pgSourceId) ?? null;
    let page = 1;
    let totalPages = 1;
    let perPage = SETS_INITIAL_PER_PAGE;
    do {
      const data = await fetchWithShrink(
        (pp) =>
          gql<PhaseGroupSetsData>(
            setsQuery,
            { phaseGroupId: pgSourceId, page, perPage: pp },
            { opName: `pg ${pgSourceId} sets page=${page} perPage=${pp}` },
          ),
        perPage,
        SETS_MIN_PER_PAGE,
        (newPerPage) => {
          perPage = newPerPage;
        },
      );
      totalPages = data.phaseGroup?.sets?.pageInfo?.totalPages ?? 1;
      for (const s of data.phaseGroup?.sets?.nodes ?? []) {
        if (!s) continue;
        await upsertSet(
          s as Record<string, unknown>,
          eventDbId,
          phaseGroupDbId,
          entrantsLookup,
          Source.STARTGG,
        );
      }
      page++;
    } while (page <= totalPages);

    await prisma.ingestionCheckpoint.upsert({
      where: { runId_scopeKey_stage: { runId, scopeKey, stage: `sets:${pgSourceId}` } },
      create: { runId, scopeKey, stage: `sets:${pgSourceId}`, page: 1, done: true },
      update: { done: true, page: 1 },
    });
  }

  // Made it through every phase group's sets without throwing — mark the
  // event as fully ingested so the next run can skip it.
  await prisma.event.update({
    where: { id: eventDbId },
    data: { ingestionCompletedAt: new Date() },
  });
}

/**
 * Run a fetch that takes a perPage. If the server reports the query was too
 * complex, halve perPage and retry. Calls onShrink with the working perPage so
 * the caller can remember it for subsequent pages.
 */
async function fetchWithShrink<T>(
  doFetch: (perPage: number) => Promise<T>,
  initialPerPage: number,
  minPerPage: number,
  onShrink: (newPerPage: number) => void,
): Promise<T> {
  let perPage = initialPerPage;
  while (true) {
    try {
      return await doFetch(perPage);
    } catch (e) {
      if (e instanceof StartGgComplexityError && perPage > minPerPage) {
        const next = Math.max(minPerPage, Math.floor(perPage / 2));
        log.warn(
          { from: perPage, to: next, actual: e.actual },
          "complexity too high, retrying with smaller page size",
        );
        perPage = next;
        onShrink(perPage);
        continue;
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Loose response types. The actual runtime data is validated structurally —
// these are just shape hints to keep `tsc --noEmit` honest.
// ---------------------------------------------------------------------------

interface PageInfo {
  total?: number;
  totalPages?: number;
}

interface TournamentsByDateData {
  tournaments?: {
    pageInfo?: PageInfo;
    nodes?: Array<{
      id: number | string;
      name?: string | null;
      events?: Array<{ id: number | string; name?: string | null } & Record<string, unknown>>;
    } & Record<string, unknown>> | null;
  } | null;
}

interface EventDetailsData {
  event?: {
    id?: number | string;
    name?: string | null;
    phases?: Array<{
      id: number | string;
      phaseGroups?: { nodes?: Array<{ id: number | string } & Record<string, unknown>> | null };
    } & Record<string, unknown>> | null;
    entrants?: {
      pageInfo?: PageInfo;
      nodes?: Array<{ id: number | string } & Record<string, unknown>> | null;
    } | null;
    standings?: {
      pageInfo?: PageInfo;
      nodes?: Array<{ id: number | string } & Record<string, unknown>> | null;
    } | null;
  } | null;
}

interface PhaseGroupSetsData {
  phaseGroup?: {
    id?: number | string;
    sets?: {
      pageInfo?: PageInfo;
      nodes?: Array<{ id: number | string } & Record<string, unknown>> | null;
    } | null;
  } | null;
}
