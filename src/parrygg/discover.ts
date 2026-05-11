// Phase 1 dry-run: walk parry.gg's TournamentService.GetTournaments cursor
// pagination, count tournaments, count those with a Melee event, log samples.
// No DB writes. The goal is to learn (a) total volume, (b) whether
// GetTournaments returns nested events (so we can filter without N follow-up
// calls), (c) what slug parry.gg uses for Melee, and (d) how the server
// responds to a sustained call rate from this client.

import {
  GetGamesRequest,
  GetTournamentsRequest,
} from "@parry-gg/client";
import { PaginationRequest } from "@parry-gg/client";
import { call, games, tournaments } from "./client.js";
import { PARRYGG_MELEE_GAME_SLUG } from "../config.js";
import { log } from "../log.js";

interface DiscoverOpts {
  pageSize?: number;
  /** Stop after this many tournament pages (safety cap; default 10000). */
  maxPages?: number;
  /** Show this many sample tournaments at the end (default 10). */
  sampleSize?: number;
}

interface MeleeGame {
  id: string;
  name: string;
  slug: string;
}

async function findMeleeGame(): Promise<MeleeGame | null> {
  const client = games();
  const resp = await call(
    (req, meta) => client.getGames(req, meta),
    new GetGamesRequest(),
    { opName: "GetGames" },
  );
  const all = resp.getGamesList();
  log.info({ totalGames: all.length }, "parry.gg games catalog fetched");

  // Prefer slug exact match (what we'd hard-code as the default), then fall
  // back to a name fuzzy match. Log every candidate so the user can confirm.
  let match: MeleeGame | null = null;
  for (const g of all) {
    const id = g.getId();
    const name = g.getName();
    const slug = g.getSlug();
    if (slug === PARRYGG_MELEE_GAME_SLUG) {
      match = { id, name, slug };
    }
    if (/melee/i.test(name) || /melee/i.test(slug)) {
      log.info({ id, name, slug }, "candidate Melee game");
    }
  }
  if (!match) {
    // No slug match — find by name as a fallback so we still get a result.
    for (const g of all) {
      if (/melee/i.test(g.getName())) {
        match = { id: g.getId(), name: g.getName(), slug: g.getSlug() };
        break;
      }
    }
  }
  return match;
}

export async function discover(opts: DiscoverOpts = {}): Promise<void> {
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 10_000;
  const sampleSize = opts.sampleSize ?? 10;

  const melee = await findMeleeGame();
  if (!melee) {
    log.warn(
      { defaultSlug: PARRYGG_MELEE_GAME_SLUG },
      "could not find Melee in parry.gg's game catalog; continuing with no per-event match",
    );
  } else {
    log.info(melee, "Melee game identified on parry.gg");
  }
  const meleeGameId = melee?.id ?? null;
  const meleeGameSlug = melee?.slug ?? PARRYGG_MELEE_GAME_SLUG;

  const tClient = tournaments();
  let pageCount = 0;
  let cursorStruct: ReturnType<PaginationRequest["getCursor"]> | undefined =
    undefined;
  let totalTournaments = 0;
  let totalMeleeTournaments = 0;
  let totalEventsCounted = 0;
  let totalMeleeEvents = 0;
  let tournamentsWithEmbeddedEvents = 0;
  const sampleMelee: Array<{ id: string; name: string; events: number }> = [];

  while (pageCount < maxPages) {
    pageCount++;
    const req = new GetTournamentsRequest();
    const pag = new PaginationRequest();
    pag.setPageSize(pageSize);
    if (cursorStruct) pag.setCursor(cursorStruct);
    req.setPaginationRequest(pag);

    const resp = await call(
      (r, meta) => tClient.getTournaments(r, meta),
      req,
      { opName: `GetTournaments page=${pageCount} cursor=${cursorStruct ? "yes" : "none"}` },
    );

    const list = resp.getTournamentsList();
    let meleeOnThisPage = 0;
    for (const t of list) {
      totalTournaments++;
      const eventsList = t.getEventsList();
      if (eventsList.length > 0) tournamentsWithEmbeddedEvents++;
      totalEventsCounted += eventsList.length;
      let hasMelee = false;
      for (const e of eventsList) {
        const g = e.getGame();
        const gid = g?.getId();
        const gslug = g?.getSlug();
        if (
          (meleeGameId != null && gid === meleeGameId) ||
          (gslug && gslug === meleeGameSlug)
        ) {
          hasMelee = true;
          totalMeleeEvents++;
        }
      }
      if (hasMelee) {
        meleeOnThisPage++;
        totalMeleeTournaments++;
        if (sampleMelee.length < sampleSize) {
          sampleMelee.push({
            id: t.getId(),
            name: t.getName(),
            events: eventsList.length,
          });
        }
      }
    }

    const pagResp = resp.getPaginationResponse();
    const hasMore = pagResp?.getHasMore() ?? false;
    log.info(
      {
        pageCount,
        received: list.length,
        meleeOnPage: meleeOnThisPage,
        cumulativeTotal: totalTournaments,
        cumulativeMelee: totalMeleeTournaments,
        hasMore,
      },
      "tournaments page",
    );

    if (!hasMore) break;
    const next = pagResp?.getNextCursor();
    if (!next) {
      log.warn({ pageCount }, "has_more=true but next_cursor missing; stopping");
      break;
    }
    cursorStruct = next;
  }

  log.info(
    {
      pageCount,
      totalTournaments,
      tournamentsWithEmbeddedEvents,
      totalEventsCounted,
      totalMeleeTournaments,
      totalMeleeEvents,
      meleeGameId,
      meleeGameSlug,
      sampleMelee,
    },
    "discovery summary",
  );

  if (tournamentsWithEmbeddedEvents === 0 && totalTournaments > 0) {
    log.warn(
      "GetTournaments returned no embedded events on any tournament; phase 2 will need a separate event-detail call per tournament to filter to Melee",
    );
  }
}
