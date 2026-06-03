import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { setStateLabel, tagWithPrefix } from "@/lib/format";
import { effectiveSetResult } from "@/lib/curation/setResult";
import { getCurrentPeriodId } from "@/lib/curation/currentPeriod";

async function setOverrideAction(formData: FormData): Promise<void> {
  "use server";
  const setId = parseInt(String(formData.get("setId") ?? ""), 10);
  const action = String(formData.get("action") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const correctedWinnerEntrantId = parseIntOrNull(String(formData.get("correctedWinnerEntrantId") ?? ""));
  const correctedDisplayScore = String(formData.get("correctedDisplayScore") ?? "").trim() || null;
  if (!Number.isFinite(setId)) return;

  if (action === "clear") {
    await prisma.setOverride.deleteMany({ where: { setId } });
  } else if (action === "exclude") {
    if (!reason) throw new Error("reason is required");
    const periodId = await getCurrentPeriodId();
    await prisma.setOverride.upsert({
      where: { setId },
      create: {
        setId,
        kind: "EXCLUDE",
        reason,
        correctedWinnerEntrantId: null,
        correctedDisplayScore: null,
        createdInPeriodId: periodId,
      },
      update: {
        kind: "EXCLUDE",
        reason,
        correctedWinnerEntrantId: null,
        correctedDisplayScore: null,
      },
    });
  } else if (action === "correct") {
    if (!reason) throw new Error("reason is required");
    if (correctedWinnerEntrantId == null && !correctedDisplayScore) {
      throw new Error("provide a corrected winner or display score");
    }
    const periodId = await getCurrentPeriodId();
    await prisma.setOverride.upsert({
      where: { setId },
      create: {
        setId,
        kind: "CORRECT_RESULT",
        reason,
        correctedWinnerEntrantId,
        correctedDisplayScore,
        createdInPeriodId: periodId,
      },
      update: {
        kind: "CORRECT_RESULT",
        reason,
        correctedWinnerEntrantId,
        correctedDisplayScore,
      },
    });
  }
  revalidatePath(`/sets/${setId}`);
}

function parseIntOrNull(s: string): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) notFound();

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      event: { include: { tournament: true } },
      override: { include: { correctedWinnerEntrant: true, createdInPeriod: true } },
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
  const effective = effectiveSetResult(
    { winnerEntrantId: set.winnerEntrantId, displayScore: set.displayScore },
    set.override
      ? {
          kind: set.override.kind,
          reason: set.override.reason,
          correctedWinnerEntrantId: set.override.correctedWinnerEntrantId,
          correctedDisplayScore: set.override.correctedDisplayScore,
        }
      : null,
  );

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
          <div><span className="label">Score: </span>
            <span className="mono">{effective.displayScore ?? "—"}</span>
            {set.override?.kind === "CORRECT_RESULT" && set.override.correctedDisplayScore && set.displayScore !== set.override.correctedDisplayScore && (
              <span className="muted" style={{ marginLeft: 6 }}>
                (was <span className="mono">{set.displayScore ?? "—"}</span>)
              </span>
            )}
          </div>
          <div><span className="label">Winner: </span>
            {renderWinner(effective.winnerEntrantId, set.slots)}
            {set.override?.kind === "CORRECT_RESULT" && set.override.correctedWinnerEntrantId != null && set.winnerEntrantId !== set.override.correctedWinnerEntrantId && (
              <span className="muted" style={{ marginLeft: 6 }}>
                (was {renderWinner(set.winnerEntrantId, set.slots)})
              </span>
            )}
          </div>
          <div><span className="label">State: </span>{setStateLabel(set.state)}</div>
          <div><span className="label">Total games: </span>{set.totalGames ?? "—"}</div>
          <div><span className="label">VOD: </span>{set.vodUrl ? <a href={set.vodUrl} target="_blank" rel="noreferrer">link</a> : "—"}</div>
          <div><span className="label">Source: </span><span className="mono">{set.source}:{set.sourceId}</span></div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong>
            Curation status:&nbsp;
            {set.override?.kind === "EXCLUDE" ? (
              <span style={{ color: "var(--loser)" }}>excluded</span>
            ) : set.override?.kind === "CORRECT_RESULT" ? (
              <span style={{ color: "var(--warn)" }}>result corrected</span>
            ) : (
              <span className="muted">no override</span>
            )}
          </strong>
          {set.override?.createdInPeriod && (
            <span className="muted" style={{ fontSize: 12 }}>
              from <Link href={`/periods/${set.override.createdInPeriod.id}`}>{set.override.createdInPeriod.name}</Link>
            </span>
          )}
        </div>
        {set.override && (
          <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
            Reason: {set.override.reason}
          </p>
        )}
        <form action={setOverrideAction} style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <input type="hidden" name="setId" value={set.id} />
          <input
            type="text"
            name="reason"
            placeholder="reason (required for exclude / correct)"
            defaultValue={set.override?.reason ?? ""}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12 }}>Correct to:</span>
            <select name="correctedWinnerEntrantId" defaultValue={String(set.override?.correctedWinnerEntrantId ?? "")} style={{ minWidth: 180 }}>
              <option value="">— winner unchanged —</option>
              {set.slots.map((s) =>
                s.entrant ? (
                  <option key={s.entrantId ?? -1} value={s.entrantId ?? ""}>
                    {s.entrant.name ?? `entrant ${s.entrantId}`}
                  </option>
                ) : null,
              )}
            </select>
            <input
              type="text"
              name="correctedDisplayScore"
              placeholder="score (e.g. 3 - 1)"
              defaultValue={set.override?.correctedDisplayScore ?? ""}
              style={{ width: 120 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" name="action" value="exclude" className="link-button">exclude set</button>
            <button type="submit" name="action" value="correct" className="link-button">correct result</button>
            {set.override && (
              <button type="submit" name="action" value="clear" className="link-button">clear override</button>
            )}
          </div>
        </form>
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
