import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, setStateLabel, tagWithPrefix } from "@/lib/format";

const SETS_PAGE_SIZE = 100;

interface SearchParams {
  setsPage?: string;
}

export default async function PlayerPage({
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

  const player = await prisma.player.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!player) notFound();

  // Find every entrant this player participated in.
  const participantRows = await prisma.participant.findMany({
    where: { playerId: id },
    select: { entrantId: true },
  });
  const entrantIds = participantRows.map((r) => r.entrantId);

  const setsPage = Math.max(1, parseInt(sp.setsPage ?? "1", 10) || 1);

  const setsWhere = {
    slots: { some: { entrantId: { in: entrantIds } } },
  };

  const [totalSets, sets] = await Promise.all([
    prisma.set.count({ where: setsWhere }),
    prisma.set.findMany({
      where: setsWhere,
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      skip: (setsPage - 1) * SETS_PAGE_SIZE,
      take: SETS_PAGE_SIZE,
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
      },
    }),
  ]);

  const setsPageCount = Math.max(1, Math.ceil(totalSets / SETS_PAGE_SIZE));

  // Compute simple W/L from the visible page.
  let wins = 0, losses = 0;
  for (const s of sets) {
    if (s.winnerEntrantId == null) continue;
    const won = s.slots.some((sl) => sl.entrantId != null && entrantIds.includes(sl.entrantId) && sl.entrantId === s.winnerEntrantId);
    const played = s.slots.some((sl) => sl.entrantId != null && entrantIds.includes(sl.entrantId));
    if (!played) continue;
    if (won) wins++; else losses++;
  }

  return (
    <>
      <div className="crumbs">
        <Link href="/">Tournaments</Link><span>/</span><span>Player</span>
      </div>

      <h2>{tagWithPrefix(player.prefix, player.gamerTag) || `Player ${player.id}`}</h2>

      <div className="card">
        <div className="metagrid">
          <div><span className="label">Tag: </span>{player.gamerTag ?? "—"}</div>
          <div><span className="label">Prefix: </span>{player.prefix ?? "—"}</div>
          <div><span className="label">User: </span>{player.user?.slug ?? "—"}</div>
          <div><span className="label">Pronouns: </span>{player.user?.genderPronoun ?? "—"}</div>
          <div><span className="label">Sets ingested: </span>{totalSets.toLocaleString()}</div>
          <div><span className="label">Source: </span><span className="mono">{player.source}:{player.sourceId}</span></div>
        </div>
      </div>

      <h3>Sets {totalSets > 0 && <span className="muted">— this page: {wins}–{losses}</span>}</h3>

      {sets.length === 0 ? (
        <div className="empty">No sets recorded for this player.</div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Tournament</th>
                <th>Event</th>
                <th>Round</th>
                <th>Result</th>
                <th>Opponent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => {
                const my = s.slots.find((sl) => sl.entrantId != null && entrantIds.includes(sl.entrantId));
                const opp = s.slots.find((sl) => sl !== my && sl.entrantId !== my?.entrantId);
                const won = my && s.winnerEntrantId != null && my.entrantId === s.winnerEntrantId;
                return (
                  <tr key={s.id}>
                    <td className="mono">{formatDate(s.completedAt)}</td>
                    <td>
                      {s.event.tournament.slug ? (
                        <Link href={`/tournaments/${encodeURIComponent(s.event.tournament.slug)}`}>{s.event.tournament.name}</Link>
                      ) : (
                        s.event.tournament.name
                      )}
                    </td>
                    <td><Link href={`/events/${s.event.id}`}>{s.event.name}</Link></td>
                    <td>{s.fullRoundText ?? (s.round != null ? `Round ${s.round}` : "—")}</td>
                    <td>
                      {s.winnerEntrantId == null ? setStateLabel(s.state) : won ? <span style={{ color: "var(--winner)", fontWeight: 600 }}>W</span> : <span style={{ color: "var(--loser)", fontWeight: 600 }}>L</span>}
                      <span className="muted mono"> {s.displayScore ? `(${parseScore(s.displayScore) ?? s.displayScore})` : ""}</span>
                    </td>
                    <td>{opp ? renderOpp(opp) : "—"}</td>
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
              {setsPage > 1 && <a href={`/players/${id}?setsPage=${setsPage - 1}`}>‹ Prev</a>}
              <span>page {setsPage} of {setsPageCount}</span>
              {setsPage < setsPageCount && <a href={`/players/${id}?setsPage=${setsPage + 1}`}>Next ›</a>}
            </div>
          )}
        </>
      )}
    </>
  );
}

interface OppSlot {
  entrant:
    | {
        id: number;
        name: string | null;
        participants: Array<{ id: number; gamerTag: string | null; prefix: string | null; player: { id: number } | null }>;
      }
    | null;
}

function renderOpp(slot: OppSlot): React.ReactNode {
  if (!slot.entrant) return "—";
  const parts = slot.entrant.participants;
  if (parts.length === 0) return slot.entrant.name ?? "—";
  return parts.map((p, i) => (
    <span key={p.id}>
      {i > 0 && <span className="muted"> / </span>}
      {p.player ? (
        <Link href={`/players/${p.player.id}`}>{tagWithPrefix(p.prefix, p.gamerTag) || "—"}</Link>
      ) : (
        tagWithPrefix(p.prefix, p.gamerTag) || "—"
      )}
    </span>
  ));
}

function parseScore(s: string): string | null {
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  return m ? `${m[1]}-${m[2]}` : null;
}
