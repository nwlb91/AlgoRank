// Event-name normalization used by the eligibility rule lookup.
//
// Deliberately conservative: lowercase, trim, collapse internal whitespace.
// "Melee Singles", "  Melee Singles  ", and "melee singles" all collapse to
// "melee singles" — but "Melee: Singles" stays distinct from "Melee Singles"
// because punctuation is meaningful (we don't want "Singles Doubles" and
// "Singles, Doubles" to merge). If frequency-sorted review surfaces a long
// tail of near-duplicates we'd revisit, but starting tight is safer than
// starting loose.
export function normalizeEventName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}
