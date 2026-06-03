import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  eventTypeLabel,
  formatDate,
  placementLabel,
  setStateLabel,
  tagWithPrefix,
} from "@/lib/format";
import { resolveEventEligibility } from "@/lib/curation/eligibility";
import { getCurrentPeriodId } from "@/lib/curation/currentPeriod";

const SETS_PAGE_SIZE = 100;

async function setEligibilityOverrideAction(formData: FormData): Promise<void> {
  "use server";
  const eventId = parseInt(String(formData.get("eventId") ?? ""), 10);
  const action = String(formData.get("action") ?? ""); // "force-eligible" | "force-ineligible" | "clear"
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isFinite(eventId)) return;

  if (action === "clear") {
    await prisma.eventEligibilityOverride.deleteMany({ where: { eventId } });
  } else {
    if (!reason) throw new Error("reason is required");
    const eligible = action === "force-eligible";
    const periodId = await getCurrentPeriodId();
    await prisma.eventEligibilityOverride.upsert({
      where: { eventId },
      create: { eventId, eligible, reason, createdInPeriodId: periodId },
      update: { eligible, reason },
    });
  }
  revalidatePath(`/events/${eventId}`);
}

interface SearchParams {
  setsPage?: string;
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) notFound();

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      tournament: true,
      videogame: true,
      eligibilityOverride: true,
    },
  });
  if (!event) notFound();

  const eligibility = await resolveEventEligibility(event.id, event.name);

  const setsPage = Math.max(1, parseInt(sp.setsPage ?? "1", 10) || 1);

  const [phases, standings, totalSets, sets] = await Promise.all([
    prisma.phase.findMany({
      where: { eventId: id },
      orderBy: [{ phaseOrder: "asc" }, { id: "asc" }],
      include: {
        phaseGroups: {
          orderBy: [{ displayIdentifier: "asc" }, { id: "asc" }],
          include: { _count: { select: { sets: true } } },
        },
      },
    }),
    prisma.standing.findMany({
      where: { eventId: id, phaseGroupId: null },
      orderBy: [{ placement: "asc" }],
      take: 32,
      include: { entrant: true },
    }),
    prisma.set.count({ where: { eventId: id } }),
    prisma.set.findMany({
      where: { eventId: id },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
      skip: (setsPage - 1) * SETS_PAGE_SIZE,
      take: SETS_PAGE_SIZE,
      include: {
        slots: {
          orderBy: { slotIndex: "asc" },
          include: {
            entrant: {
              include: {
                participants: { include: { player: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const setsPageCount = Math.max(1, Math.ceil(totalSets / SETS_PAGE_SIZE));

  return (
    <>
      <div className="crumbs">
        <Link href="/">Tournaments</Link><span>/</span>
        {event.tournament.slug ? (
          <Link href={`/tournaments/${encodeURIComponent(event.tournament.slug)}`}>{event.tournament.name}</Link>
        ) : (
          <span>{event.tournament.name}</span>
        )}
        <span>/</span><span>{event.name}</span>
      </div>

      <h2>{event.name}</h2>

      <div className="card">
        <div className="metagrid">
          <div><span className="label">Game: </span>{event.videogame?.displayName ?? event.videogame?.name ?? "—"}</div>
          <div><span className="label">Type: </span>
            <span className={`badge ${event.type === 1 ? "singles" : event.type === 5 ? "doubles" : ""}`}>
              {eventTypeLabel(event.type)}
            </span>
          </div>
          <div><span className="label">Entrants: </span>{event.numEntrants ?? "—"}</div>
          <div><span className="label">Date: </span>{formatDate(event.startAt)}</div>
          <div><span className="label">Source: </span><span className="mono">{event.source}:{event.sourceId}</span></div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong>
            Eligibility:&nbsp;
            {eligibility.eligible ? (
              <span style={{ color: "var(--winner)" }}>eligible</span>
            ) : (
              <span style={{ color: "var(--loser)" }}>ineligible</span>
            )}
          </strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {eligibility.kind === "override" && <>per-event override</>}
            {eligibility.kind === "name-rule" && <>name rule: <code>{eligibility.normalizedName}</code></>}
            {eligibility.kind === "default-deny" && <>no rule for <code>{eligibility.normalizedName}</code> (default-deny)</>}
          </span>
        </div>
        {eligibility.kind === "override" && (
          <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
            Reason: {event.eligibilityOverride?.reason}
          </p>
        )}
        <form action={setEligibilityOverrideAction} style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="eventId" value={event.id} />
          <input
            type="text"
            name="reason"
            placeholder="reason (required when forcing)"
            defaultValue={event.eligibilityOverride?.reason ?? ""}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button type="submit" name="action" value="force-eligible" className="link-button">force eligible</button>
          <button type="submit" name="action" value="force-ineligible" className="link-button">force ineligible</button>
          {event.eligibilityOverride && (
            <button type="submit" name="action" value="clear" className="link-button">clear override</button>
          )}
        </form>
      </div>

      <h3>Brackets</h3>
      {phases.length === 0 ? (
        <div className="empty">No phases ingested for this event.</div>
      ) : (
        phases.map((ph) => (
          <div key={ph.id} className="card" style={{ paddingBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <strong>{ph.name ?? `Phase ${ph.phaseOrder ?? ph.id}`}</strong>
              <span className="muted">{ph.bracketType ?? ""}</span>
            </div>
            {ph.phaseGroups.length === 0 ? (
              <div className="muted">No phase groups recorded.</div>
            ) : (
              <div className="phase-group-list">
                {ph.phaseGroups.map((pg) => (
                  <Link key={pg.id} href={`/phase-groups/${pg.id}`}>
                    {pg.displayIdentifier ?? `Group ${pg.id}`}
                    <span className="pg-meta">{pg._count.sets} sets</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      <h3>Top {Math.min(32, standings.length)} placements</h3>
      {standings.length === 0 ? (
        <div className="empty">No standings recorded for this event.</div>
      ) : (
        <ol className="placements">
          {standings.map((s) => (
            <li key={s.id}>
              <strong>{placementLabel(s.placement)}</strong> — {s.entrant?.name ?? "—"}
            </li>
          ))}
        </ol>
      )}

      <h3>Sets ({totalSets.toLocaleString()})</h3>
      {sets.length === 0 ? (
        <div className="empty">No sets recorded for this event.</div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Round</th>
                <th>Player 1</th>
                <th className="mono">Score</th>
                <th>Player 2</th>
                <th>State</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => {
                const slot1 = s.slots[0];
                const slot2 = s.slots[1];
                const winner1 = slot1?.entrantId != null && s.winnerEntrantId === slot1.entrantId;
                const winner2 = slot2?.entrantId != null && s.winnerEntrantId === slot2.entrantId;
                const cls = `set-row ${winner1 ? "winner-1" : winner2 ? "winner-2" : ""}`;
                const score = parseDisplayScore(s.displayScore);
                return (
                  <tr key={s.id} className={cls}>
                    <td>{s.fullRoundText ?? (s.round != null ? `Round ${s.round}` : "—")}</td>
                    <td>{slot1 ? renderEntrantCell(slot1) : "—"}</td>
                    <td className="mono">
                      <span className="score-1">{score?.[0] ?? ""}</span>
                      <span className="muted"> – </span>
                      <span className="score-2">{score?.[1] ?? ""}</span>
                    </td>
                    <td>{slot2 ? renderEntrantCell(slot2) : "—"}</td>
                    <td>{setStateLabel(s.state)}</td>
                    <td className="row-actions"><Link href={`/sets/${s.id}`}>view</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {setsPageCount > 1 && (
            <div className="pager">
              <span>{totalSets.toLocaleString()} sets</span>
              <div className="spacer" />
              {setsPage > 1 && <a href={`/events/${id}?setsPage=${setsPage - 1}`}>‹ Prev</a>}
              <span>page {setsPage} of {setsPageCount}</span>
              {setsPage < setsPageCount && <a href={`/events/${id}?setsPage=${setsPage + 1}`}>Next ›</a>}
            </div>
          )}
        </>
      )}
    </>
  );
}

interface EntrantCellSlot {
  entrant:
    | (
        | {
            id: number;
            name: string | null;
            participants: Array<{ id: number; gamerTag: string | null; prefix: string | null; player: { id: number } | null }>;
          }
      )
    | null;
}

function renderEntrantCell(slot: EntrantCellSlot): React.ReactNode {
  if (!slot.entrant) return "—";
  const ent = slot.entrant;
  const parts = ent.participants;
  if (parts.length === 1) {
    const p = parts[0]!;
    const link = p.player ? `/players/${p.player.id}` : null;
    const text = tagWithPrefix(p.prefix, p.gamerTag) || ent.name || "—";
    return link ? <Link href={link}>{text}</Link> : <span>{text}</span>;
  }
  if (parts.length > 1) {
    return (
      <>
        {parts.map((p, i) => (
          <span key={p.id}>
            {i > 0 && <span className="muted"> / </span>}
            {p.player ? (
              <Link href={`/players/${p.player.id}`}>{tagWithPrefix(p.prefix, p.gamerTag) || "—"}</Link>
            ) : (
              <span>{tagWithPrefix(p.prefix, p.gamerTag) || "—"}</span>
            )}
          </span>
        ))}
      </>
    );
  }
  return <span>{ent.name ?? "—"}</span>;
}

function parseDisplayScore(s: string | null): [string, string] | null {
  // start.gg displayScore looks like "Mango 3 - 2 Hungrybox" or "0 - 0".
  if (!s) return null;
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  return [m[1]!, m[2]!];
}
