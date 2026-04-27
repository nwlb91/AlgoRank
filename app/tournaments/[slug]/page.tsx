import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDateRange, eventTypeLabel } from "@/lib/format";

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);

  const tournament = await prisma.tournament.findFirst({
    where: { OR: [{ slug: decoded }, { shortSlug: decoded }] },
    include: {
      events: {
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        include: { _count: { select: { sets: true, entrants: true } } },
      },
    },
  });

  if (!tournament) notFound();

  return (
    <>
      <div className="crumbs">
        <Link href="/">Tournaments</Link><span>/</span><span>{tournament.name}</span>
      </div>

      <h2>{tournament.name}</h2>

      <div className="card">
        <div className="metagrid">
          <div><span className="label">Dates: </span>{formatDateRange(tournament.startAt, tournament.endAt)}</div>
          <div><span className="label">Location: </span>{[tournament.venueName, tournament.city, tournament.addrState, tournament.countryCode].filter(Boolean).join(", ") || "—"}</div>
          <div><span className="label">Attendees: </span>{tournament.numAttendees ?? "—"}</div>
          <div><span className="label">Online: </span>{tournament.isOnline ? "yes" : "no"}</div>
          <div><span className="label">Slug: </span><span className="mono">{tournament.slug ?? "—"}</span></div>
          <div><span className="label">Source: </span><span className="mono">{tournament.source}:{tournament.sourceId}</span></div>
        </div>
      </div>

      <h3>Events</h3>
      {tournament.events.length === 0 ? (
        <div className="empty">No events ingested for this tournament.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Type</th>
              <th>Entrants</th>
              <th>Sets</th>
            </tr>
          </thead>
          <tbody>
            {tournament.events.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/events/${e.id}`}>{e.name}</Link>
                </td>
                <td>
                  <span className={`badge ${e.type === 1 ? "singles" : e.type === 5 ? "doubles" : ""}`}>
                    {eventTypeLabel(e.type)}
                  </span>
                </td>
                <td>{e._count.entrants}</td>
                <td>{e._count.sets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
