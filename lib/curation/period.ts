// Period scope resolution. Default-by-window with per-tournament overrides.
//
// A tournament is in scope for a period iff:
//   - an explicit inclusion row exists (included=true), OR
//   - no explicit row exists AND the tournament's startAt falls in
//     [period.startAt, period.endAt].
// Explicit exclusion (included=false) overrides the window default.
//
// Game / event-type matching is enforced at the event level by callers
// (see eligibility.ts) — RankingPeriod carries optional videogameId and
// eventType filters but they are not applied here at the tournament level
// because a tournament can host events of multiple games / types.

import type { Prisma } from "@prisma/client";

interface PeriodScope {
  startAt: Date;
  endAt: Date;
}

/**
 * Build a Prisma `where` fragment for "tournaments in scope for this period".
 * Intended to be merged into a `prisma.tournament.findMany({ where: ... })`.
 *
 * The fragment is a top-level AND of two OR clauses:
 *   ( explicit-include OR (in-window AND NOT explicit-exclude) )
 */
export function tournamentsInPeriodWhere(
  periodId: number,
  period: PeriodScope,
): Prisma.TournamentWhereInput {
  return {
    OR: [
      {
        periodInclusions: {
          some: { periodId, included: true },
        },
      },
      {
        AND: [
          { startAt: { gte: period.startAt, lte: period.endAt } },
          {
            periodInclusions: {
              none: { periodId, included: false },
            },
          },
        ],
      },
    ],
  };
}
