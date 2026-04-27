// Tiny formatting helpers used across pages.

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

export function formatDateRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return "—";
  const s = formatDate(start);
  const e = formatDate(end);
  return s === e ? s : `${s} → ${e}`;
}

export function eventTypeLabel(type: number | null): string {
  if (type === 1) return "Singles";
  if (type === 5) return "Doubles";
  return type == null ? "—" : `Type ${type}`;
}

export function setStateLabel(state: number | null): string {
  // start.gg state values: 1=created, 2=ongoing, 3=completed, 6=invalid, 7=called.
  switch (state) {
    case 1: return "Created";
    case 2: return "Ongoing";
    case 3: return "Completed";
    case 6: return "Invalid";
    case 7: return "Called";
    default: return state == null ? "—" : `State ${state}`;
  }
}

export function placementLabel(p: number | null): string {
  if (p == null) return "—";
  const mod10 = p % 10;
  const mod100 = p % 100;
  let suffix = "th";
  if (mod10 === 1 && mod100 !== 11) suffix = "st";
  else if (mod10 === 2 && mod100 !== 12) suffix = "nd";
  else if (mod10 === 3 && mod100 !== 13) suffix = "rd";
  return `${p}${suffix}`;
}

export function tagWithPrefix(prefix: string | null | undefined, tag: string | null | undefined): string {
  const t = tag ?? "";
  if (!prefix) return t;
  return `${prefix} | ${t}`;
}
