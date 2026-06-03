// Event eligibility resolution.
//
// Resolution order (first match wins):
//   1. EventEligibilityOverride row on this event → its `eligible` flag
//   2. EventNameRule for the normalized name → its `eligible` flag
//   3. No rule → ineligible (default-deny)
//
// The reason returned in each case lets the UI explain *why* a given event
// is/isn't eligible without the caller re-running the resolution logic.

import { prisma } from "@/lib/db";
import { normalizeEventName } from "./normalize";

export type EligibilitySource =
  | { kind: "override"; eligible: boolean; reason: string; overrideId: number }
  | { kind: "name-rule"; eligible: boolean; reason: string | null; ruleId: number; normalizedName: string }
  | { kind: "default-deny"; eligible: false; reason: null; normalizedName: string };

export async function resolveEventEligibility(
  eventId: number,
  eventName: string,
): Promise<EligibilitySource> {
  const override = await prisma.eventEligibilityOverride.findUnique({
    where: { eventId },
    select: { id: true, eligible: true, reason: true },
  });
  if (override) {
    return {
      kind: "override",
      eligible: override.eligible,
      reason: override.reason,
      overrideId: override.id,
    };
  }

  const normalized = normalizeEventName(eventName);
  const rule = await prisma.eventNameRule.findUnique({
    where: { normalizedName: normalized },
    select: { id: true, eligible: true, reason: true },
  });
  if (rule) {
    return {
      kind: "name-rule",
      eligible: rule.eligible,
      reason: rule.reason,
      ruleId: rule.id,
      normalizedName: normalized,
    };
  }

  return { kind: "default-deny", eligible: false, reason: null, normalizedName: normalized };
}
