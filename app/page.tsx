import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateRange } from "@/lib/format";

const PAGE_SIZE = 50;

interface SearchParams {
  q?: string;
  since?: string;
  until?: string;
  page?: string;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const since = parseDate(sp.since);
  const until = parseDate(sp.until, { endOfDay: true });
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const where: Prisma.TournamentWhereInput = {};
  if (q) where.name = { contains: q };
  if (since || until) {
    where.startAt = {
      ...(since ? { gte: since } : {}),
      ...(until ? { lte: until } : {}),
    };
  }

  const [total, tournaments] = await Promise.all([
    prisma.tournament.count({ where }),
    prisma.tournament.findMany({
      where,
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        _count: { select: { events: true } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h2>Tournaments</h2>

      <form className="search-form" method="get" action="/">
        <input type="text" name="q" placeholder="Search by tournament name…" defaultValue={q} />
        <input type="date" name="since" defaultValue={sp.since ?? ""} title="Start on or after" />
        <input type="date" name="until" defaultValue={sp.until ?? ""} title="Start on or before" />
        <button type="submit">Filter</button>
        {(q || sp.since || sp.until) && <a className="clear" href="/">clear</a>}
      </form>

      {tournaments.length === 0 ? (
        <div className="empty">
          No tournaments match. {total === 0 ? "The database may be empty — run an ingest first." : ""}
        </div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th>Location</th>
                <th>Events</th>
                <th>Attendees</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.slug ? (
                      <Link href={`/tournaments/${encodeURIComponent(t.slug)}`}>{t.name}</Link>
                    ) : (
                      t.name
                    )}
                  </td>
                  <td className="mono">{formatDateRange(t.startAt, t.endAt)}</td>
                  <td>{[t.city, t.addrState, t.countryCode].filter(Boolean).join(", ") || "—"}</td>
                  <td>{t._count.events}</td>
                  <td>{t.numAttendees ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pager page={page} pageCount={pageCount} total={total} sp={sp} />
        </>
      )}
    </>
  );
}

function Pager({ page, pageCount, total, sp }: { page: number; pageCount: number; total: number; sp: SearchParams }) {
  const make = (p: number): string => {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.since) params.set("since", sp.since);
    if (sp.until) params.set("until", sp.until);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };
  return (
    <div className="pager">
      <span>{total.toLocaleString()} tournaments</span>
      <div className="spacer" />
      {page > 1 && <a href={make(page - 1)}>‹ Prev</a>}
      <span>page {page} of {pageCount}</span>
      {page < pageCount && <a href={make(page + 1)}>Next ›</a>}
    </div>
  );
}

function parseDate(s: string | undefined, opts: { endOfDay?: boolean } = {}): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T${opts.endOfDay ? "23:59:59" : "00:00:00"}Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}
