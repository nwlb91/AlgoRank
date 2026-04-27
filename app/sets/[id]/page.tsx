import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { setStateLabel, tagWithPrefix } from "@/lib/format";

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) notFound();

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      event: { include: { tournament: true } },
      slots: {
        orderBy: { slotIndex: "asc" },
        include: {
          entrant: {
            include: { participants: { include: { player: true } } },
          },
        },
      },
      games: {
        orderBy: { orderNum: "asc" },
        include: {
          stage: true,
          selections: {
            include: { character: true, entrant: true },
          },
        },
      },
    },
  });
  if (!set) notFound();

  const slot1 = set.slots[0];
  const slot2 = set.slots[1];

  return (
    <>
      <div className="crumbs">
        <Link href="/">Tournaments</Link><span>/</span>
        {set.event.tournament.slug && (
          <Link href={`/tournaments/${encodeURIComponent(set.event.tournament.slug)}`}>{set.event.tournament.name}</Link>
        )}
        <span>/</span>
        <Link href={`/events/${set.event.id}`}>{set.event.name}</Link>
        <span>/</span><span>Set {set.identifier ?? set.id}</span>
      </div>

      <h2>{set.fullRoundText ?? (set.round != null ? `Round ${set.round}` : "Set")}</h2>

      <div className="card">
        <div className="metagrid">
          <div><span className="label">Players: </span>
            {renderSlotInline(slot1)} <span className="muted">vs</span> {renderSlotInline(slot2)}
          </div>
          <div><span className="label">Score: </span><span className="mono">{set.displayScore ?? "—"}</span></div>
          <div><span className="label">Winner: </span>{renderWinner(set.winnerEntrantId, set.slots)}</div>
          <div><span className="label">State: </span>{setStateLabel(set.state)}</div>
          <div><span className="label">Total games: </span>{set.totalGames ?? "—"}</div>
          <div><span className="label">VOD: </span>{set.vodUrl ? <a href={set.vodUrl} target="_blank" rel="noreferrer">link</a> : "—"}</div>
          <div><span className="label">Source: </span><span className="mono">{set.source}:{set.sourceId}</span></div>
        </div>
      </div>

      <h3>Games</h3>
      {set.games.length === 0 ? (
        <div className="empty">No per-game data recorded for this set.</div>
      ) : (
        <div className="games">
          {set.games.map((g) => {
            const sels = g.selections;
            const e1 = slot1?.entrantId ?? null;
            const e2 = slot2?.entrantId ?? null;
            const picksFor = (eid: number | null): string =>
              sels.filter((s) => s.entrantId === eid).map((s) => s.character?.name).filter(Boolean).join(", ");
            const winSide: 1 | 2 | null =
              g.winnerEntrantId == null ? null : g.winnerEntrantId === e1 ? 1 : g.winnerEntrantId === e2 ? 2 : null;
            return (
              <div className="game" key={g.id}>
                <div className="gnum">G{g.orderNum}</div>
                <div className={`side ${winSide === 1 ? "win" : ""}`}>
                  <span>{slot1 ? entrantText(slot1) : "—"}</span>
                  <span className="picks">{picksFor(e1) || "—"}</span>
                </div>
                <div className={`side ${winSide === 2 ? "win" : ""}`}>
                  <span>{slot2 ? entrantText(slot2) : "—"}</span>
                  <span className="picks">{picksFor(e2) || "—"}</span>
                </div>
                <div style={{ gridColumn: "1 / -1", color: "var(--fg-dim)", fontSize: 12, marginTop: 4 }}>
                  Stage: {g.stage?.name ?? "—"}
                  {g.entrant1Score != null || g.entrant2Score != null
                    ? ` · stocks ${g.entrant1Score ?? "?"} – ${g.entrant2Score ?? "?"}`
                    : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

type SlotForRender =
  | {
      slotIndex: number;
      entrantId: number | null;
      entrant:
        | {
            id: number;
            name: string | null;
            participants: Array<{ id: number; gamerTag: string | null; prefix: string | null; player: { id: number } | null }>;
          }
        | null;
    }
  | undefined;

function renderSlotInline(slot: SlotForRender): React.ReactNode {
  if (!slot?.entrant) return <span className="muted">—</span>;
  const parts = slot.entrant.participants;
  if (parts.length === 0) return <span>{slot.entrant.name ?? "—"}</span>;
  return (
    <span className="tag">
      {parts.map((p, i) => (
        <span key={p.id}>
          {i > 0 && <span className="muted"> / </span>}
          {p.player ? (
            <Link href={`/players/${p.player.id}`}>{tagWithPrefix(p.prefix, p.gamerTag) || "—"}</Link>
          ) : (
            tagWithPrefix(p.prefix, p.gamerTag) || "—"
          )}
        </span>
      ))}
    </span>
  );
}

function entrantText(slot: SlotForRender): string {
  if (!slot?.entrant) return "—";
  const parts = slot.entrant.participants;
  if (parts.length === 0) return slot.entrant.name ?? "—";
  return parts.map((p) => tagWithPrefix(p.prefix, p.gamerTag) || "—").join(" / ");
}

function renderWinner(winnerEntrantId: number | null, slots: SlotForRender[]): React.ReactNode {
  if (winnerEntrantId == null) return <span className="muted">—</span>;
  const w = slots.find((s) => s?.entrantId === winnerEntrantId);
  return w ? renderSlotInline(w) : <span className="muted">unknown</span>;
}
