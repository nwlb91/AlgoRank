// Source-agnostic upsert layer. Every entity that originates outside our DB
// flows through here. The contract:
//   - Caller passes the source, the source-specific id, the modeled fields,
//     and the full upstream payload as `rawJson`.
//   - We upsert by (source, sourceId), refreshing modeled fields and
//     overwriting rawJson with the latest payload.
//   - We never delete anything implicitly.
//
// All datetime conversions live here so the rest of the ingester deals in
// plain JS values. start.gg returns Unix seconds for timestamps.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { externalKey, type Source } from "../config.js";

type Tx = Pick<PrismaClient, "videogame" | "tournament" | "event" | "phase" | "phaseGroup" | "entrant" | "participant" | "player" | "user" | "set" | "setSlot" | "game" | "gameSelection" | "standing" | "character" | "stage">;

function epochToDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v * 1000);
  if (typeof v === "string" && /^\d+$/.test(v)) return new Date(Number(v) * 1000);
  return null;
}

function asString(v: unknown): string | null {
  return v == null ? null : String(v);
}
function asNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function asBool(v: unknown): boolean | null {
  return v == null ? null : Boolean(v);
}

const stringify = (v: unknown): string => JSON.stringify(v);

export interface UpsertOpts {
  source: Source;
  sourceId: string | number;
  /** The full upstream payload for this entity. Stored verbatim in rawJson. */
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Reference tables
// ---------------------------------------------------------------------------

export async function upsertVideogame(
  v: Record<string, unknown>,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(v.id);
  const key = externalKey(source, sourceId);
  const data = {
    source,
    sourceId,
    externalKey: key,
    name: asString(v.name) ?? "",
    displayName: asString(v.displayName),
    slug: asString(v.slug),
    rawJson: stringify(v),
    lastSeenAt: new Date(),
  } satisfies Prisma.VideogameUncheckedCreateInput;
  const row = await tx.videogame.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

export async function upsertCharacter(
  c: Record<string, unknown>,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(c.id);
  const key = externalKey(source, sourceId);
  const data = {
    source,
    sourceId,
    externalKey: key,
    name: asString(c.name) ?? "",
    rawJson: stringify(c),
    lastSeenAt: new Date(),
  } satisfies Prisma.CharacterUncheckedCreateInput;
  const row = await tx.character.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

export async function upsertStage(
  s: Record<string, unknown>,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(s.id);
  const key = externalKey(source, sourceId);
  const data = {
    source,
    sourceId,
    externalKey: key,
    name: asString(s.name) ?? "",
    rawJson: stringify(s),
    lastSeenAt: new Date(),
  } satisfies Prisma.StageUncheckedCreateInput;
  const row = await tx.stage.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export async function upsertUser(
  u: Record<string, unknown> | null | undefined,
  source: Source,
  tx: Tx = prisma,
): Promise<number | null> {
  if (!u || u.id == null) return null;
  const sourceId = String(u.id);
  const key = externalKey(source, sourceId);
  const data = {
    source,
    sourceId,
    externalKey: key,
    slug: asString(u.slug),
    discriminator: asString(u.discriminator),
    name: asString(u.name),
    bio: asString(u.bio),
    location: asString(u.location),
    genderPronoun: asString(u.genderPronoun),
    rawJson: stringify(u),
    lastSeenAt: new Date(),
  } satisfies Prisma.UserUncheckedCreateInput;
  const row = await tx.user.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

export async function upsertPlayer(
  p: Record<string, unknown> | null | undefined,
  source: Source,
  tx: Tx = prisma,
): Promise<number | null> {
  if (!p || p.id == null) return null;
  const sourceId = String(p.id);
  const key = externalKey(source, sourceId);
  const userRow = (p.user as Record<string, unknown> | undefined) ?? null;
  const userId = userRow ? await upsertUser(userRow, source, tx) : null;
  const data = {
    source,
    sourceId,
    externalKey: key,
    gamerTag: asString(p.gamerTag),
    prefix: asString(p.prefix),
    userId,
    rawJson: stringify(p),
    lastSeenAt: new Date(),
  } satisfies Prisma.PlayerUncheckedCreateInput;
  const row = await tx.player.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Tournament hierarchy
// ---------------------------------------------------------------------------

export async function upsertTournament(
  t: Record<string, unknown>,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(t.id);
  const key = externalKey(source, sourceId);
  const data = {
    source,
    sourceId,
    externalKey: key,
    name: asString(t.name) ?? "",
    slug: asString(t.slug),
    shortSlug: asString(t.shortSlug),
    startAt: epochToDate(t.startAt),
    endAt: epochToDate(t.endAt),
    registrationClosesAt: epochToDate(t.registrationClosesAt),
    timezone: asString(t.timezone),
    city: asString(t.city),
    addrState: asString(t.addrState),
    countryCode: asString(t.countryCode),
    postalCode: asString(t.postalCode),
    lat: asNumber(t.lat),
    lng: asNumber(t.lng),
    venueName: asString(t.venueName),
    venueAddress: asString(t.venueAddress),
    hashtag: asString(t.hashtag),
    currency: asString(t.currency),
    isOnline: asBool(t.isOnline),
    hasOfflineEvents: asBool(t.hasOfflineEvents),
    hasOnlineEvents: asBool(t.hasOnlineEvents),
    numAttendees: asNumber(t.numAttendees),
    ownerSourceId: asString(t.ownerId),
    primaryContact: asString(t.primaryContact),
    primaryContactType: asString(t.primaryContactType),
    mapsPlaceId: asString(t.mapsPlaceId),
    rules: asString(t.rules),
    url: asString(t.url),
    rawJson: stringify(t),
    lastSeenAt: new Date(),
  } satisfies Prisma.TournamentUncheckedCreateInput;
  const row = await tx.tournament.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

export async function upsertEvent(
  e: Record<string, unknown>,
  tournamentId: number,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(e.id);
  const key = externalKey(source, sourceId);
  const vg = (e.videogame as Record<string, unknown> | undefined) ?? null;
  const videogameId = vg ? await upsertVideogame(vg, source, tx) : null;
  const data = {
    source,
    sourceId,
    externalKey: key,
    tournamentId,
    videogameId,
    name: asString(e.name) ?? "",
    slug: asString(e.slug),
    type: asNumber(e.type),
    startAt: epochToDate(e.startAt),
    state: asNumber(e.state),
    numEntrants: asNumber(e.numEntrants),
    teamRosterSize: asNumber(e.teamRosterSize),
    isOnline: asBool(e.isOnline),
    prizingInfo: typeof e.prizingInfo === "string" ? e.prizingInfo : (e.prizingInfo == null ? null : stringify(e.prizingInfo)),
    rulesetId: asNumber(e.rulesetId),
    useEventSeeds: asBool(e.useEventSeeds),
    ownerSourceId: asString(e.ownerId),
    rawJson: stringify(e),
    lastSeenAt: new Date(),
  } satisfies Prisma.EventUncheckedCreateInput;
  const row = await tx.event.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

export async function upsertPhase(
  p: Record<string, unknown>,
  eventId: number,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(p.id);
  const key = externalKey(source, sourceId);
  const data = {
    source,
    sourceId,
    externalKey: key,
    eventId,
    name: asString(p.name),
    phaseOrder: asNumber(p.phaseOrder),
    numSeeds: asNumber(p.numSeeds),
    bracketType: asString(p.bracketType),
    groupCount: asNumber(p.groupCount),
    isExhibition: asBool(p.isExhibition),
    state: asNumber(p.state),
    rawJson: stringify(p),
    lastSeenAt: new Date(),
  } satisfies Prisma.PhaseUncheckedCreateInput;
  const row = await tx.phase.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

export async function upsertPhaseGroup(
  pg: Record<string, unknown>,
  phaseId: number,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(pg.id);
  const key = externalKey(source, sourceId);
  const data = {
    source,
    sourceId,
    externalKey: key,
    phaseId,
    displayIdentifier: asString(pg.displayIdentifier),
    bracketType: asString(pg.bracketType),
    firstRoundTime: epochToDate(pg.firstRoundTime),
    state: asNumber(pg.state),
    waveSourceId: pg.waveId == null ? null : String(pg.waveId),
    numRounds: asNumber(pg.numRounds),
    rawJson: stringify(pg),
    lastSeenAt: new Date(),
  } satisfies Prisma.PhaseGroupUncheckedCreateInput;
  const row = await tx.phaseGroup.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Entrants & participants
// ---------------------------------------------------------------------------

export async function upsertEntrant(
  e: Record<string, unknown>,
  eventId: number,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(e.id);
  const key = externalKey(source, sourceId);
  const seeds = (e.seeds as Array<Record<string, unknown>> | undefined) ?? [];
  const initialSeedNum = seeds[0] ? asNumber(seeds[0].seedNum) : null;
  const data = {
    source,
    sourceId,
    externalKey: key,
    eventId,
    name: asString(e.name),
    isDisqualified: asBool(e.isDisqualified),
    initialSeedNum,
    rawJson: stringify(e),
    lastSeenAt: new Date(),
  } satisfies Prisma.EntrantUncheckedCreateInput;
  const row = await tx.entrant.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });

  for (const part of (e.participants as Array<Record<string, unknown>> | undefined) ?? []) {
    await upsertParticipant(part, row.id, source, tx);
  }

  return row.id;
}

export async function upsertParticipant(
  p: Record<string, unknown>,
  entrantId: number,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(p.id);
  const key = externalKey(source, sourceId);
  const playerRow = (p.player as Record<string, unknown> | undefined) ?? null;
  const playerId = playerRow ? await upsertPlayer(playerRow, source, tx) : null;
  // Some payloads include a top-level `user` on Participant. Persist it too.
  const userRow = (p.user as Record<string, unknown> | undefined) ?? null;
  if (userRow) await upsertUser(userRow, source, tx);
  const data = {
    source,
    sourceId,
    externalKey: key,
    entrantId,
    playerId,
    gamerTag: asString(p.gamerTag),
    prefix: asString(p.prefix),
    rawJson: stringify(p),
    lastSeenAt: new Date(),
  } satisfies Prisma.ParticipantUncheckedCreateInput;
  const row = await tx.participant.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Sets, slots, games, selections
// ---------------------------------------------------------------------------

export interface EntrantLookup {
  bySourceId(id: string | number | null | undefined): number | null;
}

export async function upsertSet(
  s: Record<string, unknown>,
  eventId: number,
  phaseGroupId: number | null,
  entrants: EntrantLookup,
  source: Source,
  tx: Tx = prisma,
): Promise<number> {
  const sourceId = String(s.id);
  const key = externalKey(source, sourceId);
  const winnerEntrantId = entrants.bySourceId(s.winnerId as string | number | undefined);
  // Loser is whichever slot's entrant is not the winner.
  const slots = (s.slots as Array<Record<string, unknown>> | undefined) ?? [];
  let loserEntrantId: number | null = null;
  if (winnerEntrantId != null) {
    for (const slot of slots) {
      const ent = (slot.entrant as Record<string, unknown> | undefined) ?? null;
      const eid = ent ? entrants.bySourceId(ent.id as string | number | undefined) : null;
      if (eid != null && eid !== winnerEntrantId) {
        loserEntrantId = eid;
        break;
      }
    }
  }
  const data = {
    source,
    sourceId,
    externalKey: key,
    eventId,
    phaseGroupId,
    identifier: asString(s.identifier),
    displayScore: asString(s.displayScore),
    fullRoundText: asString(s.fullRoundText),
    round: asNumber(s.round),
    startedAt: epochToDate(s.startedAt),
    completedAt: epochToDate(s.completedAt),
    state: asNumber(s.state),
    totalGames: asNumber(s.totalGames),
    winnerEntrantId,
    loserEntrantId,
    isGF: asBool(s.isGF),
    lPlacement: asNumber(s.lPlacement),
    wPlacement: asNumber(s.wPlacement),
    hasPlaceholder: asBool(s.hasPlaceholder),
    hasErrors: asBool(s.hasErrors),
    station: typeof s.station === "string" ? s.station : (s.station == null ? null : stringify(s.station)),
    streamSourceId: s.stream && typeof s.stream === "object" ? String((s.stream as Record<string, unknown>).id ?? "") || null : null,
    vodUrl: asString(s.vodUrl),
    setGamesType: asNumber(s.setGamesType),
    rawJson: stringify(s),
    lastSeenAt: new Date(),
  } satisfies Prisma.SetUncheckedCreateInput;
  const row = await tx.set.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
    select: { id: true },
  });

  // Slots
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    await upsertSetSlot(slot, row.id, i, entrants, source, tx);
  }

  // Games
  for (const g of (s.games as Array<Record<string, unknown>> | undefined) ?? []) {
    await upsertGame(g, row.id, entrants, source, tx);
  }

  return row.id;
}

async function upsertSetSlot(
  slot: Record<string, unknown>,
  setId: number,
  slotIndex: number,
  entrants: EntrantLookup,
  source: Source,
  tx: Tx,
): Promise<void> {
  // Slot ids look like "<setId>-<index>" — already unique.
  const sourceId = String(slot.id ?? `${setId}-${slotIndex}`);
  const key = externalKey(source, sourceId);
  const ent = (slot.entrant as Record<string, unknown> | undefined) ?? null;
  const entrantId = ent ? entrants.bySourceId(ent.id as string | number | undefined) : null;
  const data = {
    source,
    sourceId,
    externalKey: key,
    setId,
    slotIndex,
    entrantId,
    seedNum: asNumber(slot.seedNum),
    prereqType: asString(slot.prereqType),
    prereqSourceSetId: asString(slot.prereqId),
    prereqPlacement: asNumber(slot.prereqPlacement),
    rawJson: stringify(slot),
    lastSeenAt: new Date(),
  } satisfies Prisma.SetSlotUncheckedCreateInput;
  // Key on (setId, slotIndex) — that is the slot's true identity. start.gg
  // sometimes hands out new slot.id strings for the same slot on re-fetches,
  // which would trip the (setId, slotIndex) unique constraint if we keyed
  // upsert on externalKey.
  await tx.setSlot.upsert({
    where: { setId_slotIndex: { setId, slotIndex } },
    create: data,
    update: data,
  });
}

async function upsertGame(
  g: Record<string, unknown>,
  setId: number,
  entrants: EntrantLookup,
  source: Source,
  tx: Tx,
): Promise<void> {
  const sourceId = String(g.id);
  const key = externalKey(source, sourceId);
  const stage = (g.stage as Record<string, unknown> | undefined) ?? null;
  const stageId = stage ? await upsertStage(stage, source, tx) : null;
  const winnerEntrantId = entrants.bySourceId(g.winnerId as string | number | undefined);
  const data = {
    source,
    sourceId,
    externalKey: key,
    setId,
    orderNum: asNumber(g.orderNum) ?? 0,
    winnerEntrantId,
    state: asNumber(g.state),
    stageId,
    entrant1Score: asNumber(g.entrant1Score),
    entrant2Score: asNumber(g.entrant2Score),
    rawJson: stringify(g),
    lastSeenAt: new Date(),
  } satisfies Prisma.GameUncheckedCreateInput;
  // Key on (setId, orderNum) — start.gg has been observed to issue different
  // game ids for the same (set, gameNumber) on re-fetch, so keying on
  // externalKey trips the (setId, orderNum) unique constraint.
  const row = await tx.game.upsert({
    where: { setId_orderNum: { setId, orderNum: data.orderNum } },
    create: data,
    update: data,
    select: { id: true },
  });

  for (const sel of (g.selections as Array<Record<string, unknown>> | undefined) ?? []) {
    await upsertSelection(sel, row.id, entrants, source, tx);
  }
}

async function upsertSelection(
  sel: Record<string, unknown>,
  gameId: number,
  entrants: EntrantLookup,
  source: Source,
  tx: Tx,
): Promise<void> {
  const sourceId = String(sel.id);
  const key = externalKey(source, sourceId);
  const character = (sel.character as Record<string, unknown> | undefined) ?? null;
  const characterId = character ? await upsertCharacter(character, source, tx) : null;
  const ent = (sel.entrant as Record<string, unknown> | undefined) ?? null;
  const entrantId = ent ? entrants.bySourceId(ent.id as string | number | undefined) : null;
  const data = {
    source,
    sourceId,
    externalKey: key,
    gameId,
    entrantId,
    participantId: null,
    characterId,
    selectionType: asString(sel.selectionType),
    selectionValue: asNumber(sel.selectionValue),
    orderNum: asNumber(sel.orderNum),
    rawJson: stringify(sel),
    lastSeenAt: new Date(),
  } satisfies Prisma.GameSelectionUncheckedCreateInput;
  await tx.gameSelection.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
  });
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export async function upsertStanding(
  st: Record<string, unknown>,
  scope: { eventId?: number | null; phaseGroupId?: number | null },
  entrants: EntrantLookup,
  source: Source,
  tx: Tx = prisma,
): Promise<void> {
  const sourceId = String(st.id);
  const key = externalKey(source, sourceId);
  const ent = (st.entrant as Record<string, unknown> | undefined) ?? null;
  const entrantId = ent ? entrants.bySourceId(ent.id as string | number | undefined) : null;
  const data = {
    source,
    sourceId,
    externalKey: key,
    eventId: scope.eventId ?? null,
    phaseGroupId: scope.phaseGroupId ?? null,
    entrantId,
    placement: asNumber(st.placement),
    isFinal: asBool(st.isFinal),
    totalPoints: asNumber(st.totalPoints),
    metadata: st.metadata == null ? null : stringify(st.metadata),
    rawJson: stringify(st),
    lastSeenAt: new Date(),
  } satisfies Prisma.StandingUncheckedCreateInput;
  await tx.standing.upsert({
    where: { externalKey: key },
    create: data,
    update: data,
  });
}
