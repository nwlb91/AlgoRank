// Effective set result: original Set values with SetOverride applied.
//
// Three states:
//   - no override        → use the Set's stored winner/score
//   - kind=EXCLUDE       → set is treated as if it didn't happen; included is false
//   - kind=CORRECT_RESULT→ winner/score taken from the override row
//
// Always returns the *original* values too, so the UI can show
// "result was X, overwritten to Y because Z."

export interface OriginalSetResult {
  winnerEntrantId: number | null;
  displayScore: string | null;
}

export interface SetOverrideShape {
  kind: string; // "EXCLUDE" | "CORRECT_RESULT"
  reason: string;
  correctedWinnerEntrantId: number | null;
  correctedDisplayScore: string | null;
}

export interface EffectiveSetResult {
  included: boolean;
  winnerEntrantId: number | null;
  displayScore: string | null;
  original: OriginalSetResult;
  override: SetOverrideShape | null;
}

export function effectiveSetResult(
  original: OriginalSetResult,
  override: SetOverrideShape | null,
): EffectiveSetResult {
  if (!override) {
    return { included: true, ...original, original, override: null };
  }
  if (override.kind === "EXCLUDE") {
    return {
      included: false,
      winnerEntrantId: original.winnerEntrantId,
      displayScore: original.displayScore,
      original,
      override,
    };
  }
  if (override.kind === "CORRECT_RESULT") {
    return {
      included: true,
      winnerEntrantId: override.correctedWinnerEntrantId ?? original.winnerEntrantId,
      displayScore: override.correctedDisplayScore ?? original.displayScore,
      original,
      override,
    };
  }
  // Unknown kind — fall back to original. Defensive; never expected in practice.
  return { included: true, ...original, original, override };
}
