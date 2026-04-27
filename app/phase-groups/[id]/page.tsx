import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { tagWithPrefix } from "@/lib/format";

export default async function PhaseGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) notFound();

  const phaseGroup = await prisma.phaseGroup.findUnique({
    where: { id },
    include: {
      phase: {
        include: {
          event: { include: { tournament: true } },
        },
      },
      sets: {
        orderBy: [{ round: "asc" }, { id: "asc" }],
        include: {
          slots: {
            orderBy: { slotIndex: "asc" },
            include: {
              entrant: {
                include: { participants: { include: { player: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!phaseGroup) notFound();

  const event = phaseGroup.phase.event;
  const tournament = event.tournament;

  // Map start.gg-side set sourceId → local DB id, so we can link prereq
  // pointers between cards.
  const dbIdBySourceSetId = new Map<string, number>();
  for (const s of phaseGroup.sets) dbIdBySourceSetId.set(s.sourceId, s.id);

  // Group sets by round; positive = winners, negative = losers, other = "pool"
  // (round-robin / unstructured). Sort within each round by identifier's
  // numeric chunk first so "B2" comes before "B10".
  type SetRow = (typeof phaseGroup.sets)[number];
  const winnersByRound = new Map<number, SetRow[]>();
  const losersByRound = new Map<number, SetRow[]>();
  const poolSets: SetRow[] = [];

  for (const s of phaseGroup.sets) {
    if (s.round != null && s.round > 0) {
      bucket(winnersByRound, s.round, s);
    } else if (s.round != null && s.round < 0) {
      bucket(losersByRound, s.round, s);
    } else {
      poolSets.push(s);
    }
  }
  for (const list of winnersByRound.values()) list.sort(setSortCmp);
  for (const list of losersByRound.values()) list.sort(setSortCmp);
  poolSets.sort(setSortCmp);

  const winnersRounds = [...winnersByRound.keys()].sort((a, b) => a - b);
  const losersRounds = [...losersByRound.keys()].sort((a, b) => b - a); // -1, -2, -3... rendered as L1, L2, L3...

  const totalSetsRendered = phaseGroup.sets.length;

  return (
    <>
      <div className="crumbs">
        <Link href="/">Tournaments</Link><span>/</span>
        {tournament.slug && (
          <Link href={`/tournaments/${encodeURIComponent(tournament.slug)}`}>{tournament.name}</Link>
        )}
        <span>/</span>
        <Link href={`/events/${event.id}`}>{event.name}</Link>
        <span>/</span>
        <span>{phaseGroup.phase.name ?? "Phase"} — {phaseGroup.displayIdentifier ?? `Group ${phaseGroup.id}`}</span>
      </div>

      <h2>
        {phaseGroup.phase.name ?? "Phase"} — {phaseGroup.displayIdentifier ?? `Group ${phaseGroup.id}`}
      </h2>

      <div className="card">
        <div className="metagrid">
          <div><span className="label">Bracket: </span>{phaseGroup.bracketType ?? phaseGroup.phase.bracketType ?? "—"}</div>
          <div><span className="label">Sets: </span>{totalSetsRendered}</div>
          <div><span className="label">Source: </span><span className="mono">{phaseGroup.source}:{phaseGroup.sourceId}</span></div>
          <div><span className="label">start.gg: </span>
            <a href={`https://www.start.gg/${tournament.slug ? tournament.slug + "/" : ""}event/${event.slug?.split("/").pop() ?? ""}/brackets/${phaseGroup.phase.sourceId}/${phaseGroup.sourceId}`} target="_blank" rel="noreferrer">open bracket</a>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          Each card shows both slots, the score, and the prereq pointers we stored. Compare
          the prereq references against start.gg's bracket view to verify the DAG is intact.
        </p>
      </div>

      {totalSetsRendered === 0 && (
        <div className="bracket-empty">No sets ingested for this phase group.</div>
      )}

      {winnersRounds.length > 0 && (
        <section className="bracket-section">
          <h3>Winners side</h3>
          <div className="bracket">
            {winnersRounds.map((r) => (
              <div className="bracket-col" key={`w${r}`}>
                <h4>Round {r}{firstSetIn(winnersByRound.get(r))?.fullRoundText ? ` — ${firstSetIn(winnersByRound.get(r))!.fullRoundText}` : ""}</h4>
                {(winnersByRound.get(r) ?? []).map((s) => (
                  <SetCard key={s.id} s={s} dbIdBySourceSetId={dbIdBySourceSetId} />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {losersRounds.length > 0 && (
        <section className="bracket-section">
          <h3>Losers side</h3>
          <div className="bracket">
            {losersRounds.map((r) => (
              <div className="bracket-col" key={`l${r}`}>
                <h4>L Round {Math.abs(r)}{firstSetIn(losersByRound.get(r))?.fullRoundText ? ` — ${firstSetIn(losersByRound.get(r))!.fullRoundText}` : ""}</h4>
                {(losersByRound.get(r) ?? []).map((s) => (
                  <SetCard key={s.id} s={s} dbIdBySourceSetId={dbIdBySourceSetId} />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {poolSets.length > 0 && (
        <section className="bracket-section">
          <h3>Pool sets {winnersRounds.length + losersRounds.length === 0 ? "" : "(unstructured)"}</h3>
          <div className="bracket">
            <div className="bracket-col" style={{ minWidth: 280 }}>
              {poolSets.map((s) => (
                <SetCard key={s.id} s={s} dbIdBySourceSetId={dbIdBySourceSetId} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

interface SetSlotForCard {
  slotIndex: number;
  entrantId: number | null;
  seedNum: number | null;
  prereqType: string | null;
  prereqSourceSetId: string | null;
  prereqPlacement: number | null;
  entrant:
    | {
        id: number;
        name: string | null;
        participants: Array<{ id: number; gamerTag: string | null; prefix: string | null; player: { id: number } | null }>;
      }
    | null;
}
interface SetForCard {
  id: number;
  identifier: string | null;
  fullRoundText: string | null;
  round: number | null;
  displayScore: string | null;
  totalGames: number | null;
  isGF: boolean | null;
  winnerEntrantId: number | null;
  state: number | null;
  sourceId: string;
  slots: SetSlotForCard[];
}

function SetCard({ s, dbIdBySourceSetId }: { s: SetForCard; dbIdBySourceSetId: Map<string, number> }) {
  const [slot1, slot2] = [s.slots[0], s.slots[1]];
  const score = parseDisplayScore(s.displayScore);
  const renderSlot = (slot: SetSlotForCard | undefined, scorePart: string | null): React.ReactNode => {
    if (!slot) return <div className="slot bye"><span className="name">—</span><span className="score"></span></div>;
    const isWinner = s.winnerEntrantId != null && slot.entrantId === s.winnerEntrantId;
    const isLoser = s.winnerEntrantId != null && slot.entrantId != null && slot.entrantId !== s.winnerEntrantId;
    const cls = `slot ${isWinner ? "winner" : isLoser ? "loser" : ""} ${slot.entrant ? "" : "bye"}`;
    const label = slot.entrant ? entrantLabel(slot.entrant) : (slot.prereqType === "bye" ? "(bye)" : "(empty)");
    return (
      <div className={cls}>
        <span className="name" title={label}>
          {slot.seedNum != null ? <span className="muted">{slot.seedNum}. </span> : null}
          {label}
        </span>
        <span className="score">{scorePart ?? ""}</span>
      </div>
    );
  };

  return (
    <div className="set-card">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span className="set-card-id">
          {s.identifier ? `#${s.identifier}` : `#${s.id}`}{s.isGF ? " · GF" : ""}
        </span>
        <Link className="set-card-link" href={`/sets/${s.id}`} title="Set detail">
          <span className="set-card-id">view →</span>
        </Link>
      </div>
      {renderSlot(slot1, score?.[0] ?? null)}
      {renderSlot(slot2, score?.[1] ?? null)}
      <div className="meta">
        {s.totalGames != null && <span>BO{guessBestOf(s.totalGames)}</span>}
        {s.totalGames != null && (s.slots[0]?.prereqType || s.slots[1]?.prereqType) && " · "}
        <PrereqLine slot={slot1} dbIdBySourceSetId={dbIdBySourceSetId} sideLabel="P1" />
        <PrereqLine slot={slot2} dbIdBySourceSetId={dbIdBySourceSetId} sideLabel="P2" />
      </div>
    </div>
  );
}

function PrereqLine({
  slot,
  dbIdBySourceSetId,
  sideLabel,
}: {
  slot: SetSlotForCard | undefined;
  dbIdBySourceSetId: Map<string, number>;
  sideLabel: string;
}): React.ReactNode {
  if (!slot) return null;
  if (slot.prereqType === "set" && slot.prereqSourceSetId) {
    const dbId = dbIdBySourceSetId.get(slot.prereqSourceSetId);
    const placement = slot.prereqPlacement;
    const wOrL = placement === 1 ? "winner of" : placement === 2 ? "loser of" : `place ${placement} of`;
    return (
      <div>
        {sideLabel}: {wOrL}{" "}
        {dbId ? (
          <Link href={`/sets/${dbId}`}>#{shortSourceId(slot.prereqSourceSetId)}</Link>
        ) : (
          <span title={slot.prereqSourceSetId}>#{shortSourceId(slot.prereqSourceSetId)}</span>
        )}
      </div>
    );
  }
  if (slot.prereqType === "seed") {
    return <div>{sideLabel}: seed {slot.seedNum ?? "?"}</div>;
  }
  if (slot.prereqType === "bye") {
    return <div>{sideLabel}: bye</div>;
  }
  return null;
}

function entrantLabel(ent: { name: string | null; participants: Array<{ gamerTag: string | null; prefix: string | null }> }): string {
  if (ent.participants.length === 0) return ent.name ?? "—";
  return ent.participants
    .map((p) => tagWithPrefix(p.prefix, p.gamerTag) || "—")
    .join(" / ");
}

function bucket<K, V>(m: Map<K, V[]>, k: K, v: V) {
  if (!m.has(k)) m.set(k, []);
  m.get(k)!.push(v);
}

function setSortCmp(a: { identifier: string | null; id: number }, b: { identifier: string | null; id: number }): number {
  const ka = sortKey(a.identifier);
  const kb = sortKey(b.identifier);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
  return a.id - b.id;
}

function sortKey(identifier: string | null): [number, string] {
  if (!identifier) return [Number.MAX_SAFE_INTEGER, ""];
  const m = /^(\D*)(\d+)/.exec(identifier);
  if (m) return [parseInt(m[2]!, 10), m[1] ?? ""];
  return [Number.MAX_SAFE_INTEGER, identifier];
}

function firstSetIn<T>(arr: T[] | undefined): T | undefined {
  return arr && arr.length > 0 ? arr[0] : undefined;
}

function parseDisplayScore(s: string | null): [string, string] | null {
  if (!s) return null;
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  return m ? [m[1]!, m[2]!] : null;
}

function guessBestOf(totalGames: number): number {
  // start.gg's totalGames is "max games this set is played to" — for BO5 it's 5,
  // for BO3 it's 3. Pass through unchanged.
  return totalGames;
}

function shortSourceId(s: string): string {
  // start.gg numeric set ids can be 8 digits. Show last 5 to keep cards compact.
  return s.length > 6 ? `…${s.slice(-5)}` : s;
}
