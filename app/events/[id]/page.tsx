import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  eventTypeLabel,
  formatDate,
  placementLabel,
  setStateLabel,
  tagWithPrefix,
} from "@/lib/format";

const SETS_PAGE_SIZE = 100;

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
    },
  });
  if (!event) notFound();

  const setsPage = Math.max(1, parseInt(sp.setsPage ?? "1", 10) || 1);

  const [standings, totalSets, sets] = await Promise.all([
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
