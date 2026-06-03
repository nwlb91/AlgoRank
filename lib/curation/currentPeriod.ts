// "Current period" selection — stored in a cookie so the user picks once and
// every curation page is scoped to it without URL params everywhere.
//
// All curation Server Actions read this; if no period is set they refuse to
// run (decisions need provenance even though their effect is global).

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "algorank.currentPeriodId";

export async function getCurrentPeriodId(): Promise<number | null> {
  const store = await cookies();
  const v = store.get(COOKIE_NAME)?.value;
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getCurrentPeriod() {
  const id = await getCurrentPeriodId();
  if (id == null) return null;
  return prisma.rankingPeriod.findUnique({ where: { id } });
}

export async function setCurrentPeriodId(id: number): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, String(id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearCurrentPeriod(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
