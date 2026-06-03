import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { tournamentsInPeriodWhere } from "@/lib/curation/period";
import { getCurrentPeriodId, setCurrentPeriodId } from "@/lib/curation/currentPeriod";

const TOURNAMENTS_PAGE_SIZE = 50;

async function setTournamentInclusionAction(formData: FormData): Promise<void> {
  "use server";
  const periodId = parseInt(String(formData.get("periodId") ?? ""), 10);
  const tournamentId = parseInt(String(formData.get("tournamentId") ?? ""), 10);
  const action = String(formData.get("action") ?? ""); // "force-include" | "force-exclude" | "clear"
  if (!Number.isFinite(periodId) || !Number.isFinite(tournamentId)) return;

  if (action === "clear") {
    await prisma.rankingPeriodTournament.deleteMany({
      where: { periodId, tournamentId },
    });
  } else {
    const included = action === "force-include";
    await prisma.rankingPeriodTournament.upsert({
      where: { periodId_tournamentId: { periodId, tournamentId } },
      create: { periodId, tournamentId, included },
      update: { included },
    });
  }
  revalidatePath(`/periods/${periodId}`);
}

async function makeCurrentAction(formData: FormData): Promise<void> {
  "use server";
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return;
  await setCurrentPeriodId(id);
  revalidatePath(`/periods/${id}`);
}

interface SearchParams {
  tab?: string;
  q?: string;
  page?: string;
}

export default async function PeriodDetailPage({
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

  const period = await prisma.rankingPeriod.findUnique({ where: { id } });
  if (!period) notFound();

  const currentId = await getCurrentPeriodId();
  const tab = sp.tab === "all" ? "all" : sp.tab === "exceptions" ? "exceptions" : "in-scope";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const inScopeWhere = tournamentsInPeriodWhere(period.id, {
    startAt: period.startAt,
    endAt: period.endAt,
  });
  const exceptionWhere = { periodInclusions: { some: { periodId: period.id } } };
  const where =
    tab === "in-scope" ? inScopeWhere : tab === "exceptions" ? exceptionWhere : {};
  const whereWithQ = q
    ? { AND: [where, { name: { contains: q } }] }
    : where;

  const [inScopeCount, exceptionsCount, total, tournaments] = await Promise.all([
    prisma.tournament.count({ where: inScopeWhere }),
    prisma.tournament.count({ where: exceptionWhere }),
    prisma.tournament.count({ where: whereWithQ }),
    prisma.tournament.findMany({
      where: whereWithQ,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * TOURNAMENTS_PAGE_SIZE,
      take: TOURNAMENTS_PAGE_SIZE,
      include: {
        periodInclusions: { where: { periodId: period.id } },
        _count: { select: { events: true } },
      },
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / TOURNAMENTS_PAGE_SIZE));

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link><span>/</span>
        <Link href="/periods">Ranking periods</Link><span>/</span>
        <span>{period.name}</span>
      </div>

      <h2>
        {period.name}
        {period.id === currentId ? (
          <span className="muted" style={{ marginLeft: 12, fontSize: 13 }}>current</span>
        ) : (
          <form action={makeCurrentAction} style={{ display: "inline-block", marginLeft: 12 }}>
            <input type="hidden" name="id" value={period.id} />
            <button type="submit" className="link-button" style={{ fontSize: 12 }}>make current</button>
          </form>
        )}
      </h2>

      <div className="card">
        <div className="metagrid">
          <div><span className="label">Kind: </span>{period.kind}</div>
          <div><span className="label">Window: </span>{formatDate(period.startAt)} → {formatDate(period.endAt)}</div>
          <div><span className="label">Event type: </span>{period.eventType === 1 ? "Singles" : period.eventType === 5 ? "Doubles" : "any"}</div>
        </div>
      </div>

      <h3>Tournaments</h3>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Default scope = tournament's startAt is inside the window. Use force-include / force-exclude
        to override that on a per-tournament basis (e.g. a series whose dates straddle the boundary).
      </p>
      <div className="tabs">
        <Link href={`/periods/${period.id}?tab=in-scope`} className={tab === "in-scope" ? "tab active" : "tab"}>
          in scope <span className="muted">({inScopeCount.toLocaleString()})</span>
        </Link>
        <Link href={`/periods/${period.id}?tab=exceptions`} className={tab === "exceptions" ? "tab active" : "tab"}>
          exceptions <span className="muted">({exceptionsCount.toLocaleString()})</span>
        </Link>
        <Link href={`/periods/${period.id}?tab=all`} className={tab === "all" ? "tab active" : "tab"}>
          all
        </Link>
      </div>

      <form className="search-form" method="get" action={`/periods/${period.id}`} style={{ marginTop: 12 }}>
        <input type="hidden" name="tab" value={tab} />
        <input type="text" name="q" placeholder="Search tournament name…" defaultValue={q} />
        <button type="submit">Filter</button>
        {q && <Link className="clear" href={`/periods/${period.id}?tab=${tab}`}>clear</Link>}
      </form>

      {tournaments.length === 0 ? (
        <div className="empty">No tournaments match.</div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th>Events</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => {
                const inclusion = t.periodInclusions[0];
                const inWindow = t.startAt && t.startAt >= period.startAt && t.startAt <= period.endAt;
                const status = inclusion
                  ? inclusion.included
                    ? "forced in"
                    : "forced out"
                  : inWindow
                    ? "in (window)"
                    : "out (window)";
                return (
                  <tr key={t.id}>
                    <td>
                      {t.slug ? (
                        <Link href={`/tournaments/${encodeURIComponent(t.slug)}`}>{t.name}</Link>
                      ) : (
                        t.name
                      )}
                    </td>
                    <td className="mono">{formatDate(t.startAt)}</td>
                    <td>{t._count.events}</td>
                    <td>
                      <span className={`badge ${inclusion ? (inclusion.included ? "singles" : "doubles") : ""}`}>{status}</span>
                    </td>
                    <td className="row-actions" style={{ whiteSpace: "nowrap" }}>
                      <form action={setTournamentInclusionAction} style={{ display: "inline" }}>
                        <input type="hidden" name="periodId" value={period.id} />
                        <input type="hidden" name="tournamentId" value={t.id} />
                        <input type="hidden" name="action" value="force-include" />
                        <button className="link-button" type="submit" disabled={inclusion?.included === true}>force in</button>
                      </form>
                      <span className="muted"> · </span>
                      <form action={setTournamentInclusionAction} style={{ display: "inline" }}>
                        <input type="hidden" name="periodId" value={period.id} />
                        <input type="hidden" name="tournamentId" value={t.id} />
                        <input type="hidden" name="action" value="force-exclude" />
                        <button className="link-button" type="submit" disabled={inclusion?.included === false}>force out</button>
                      </form>
                      {inclusion && (
                        <>
                          <span className="muted"> · </span>
                          <form action={setTournamentInclusionAction} style={{ display: "inline" }}>
                            <input type="hidden" name="periodId" value={period.id} />
                            <input type="hidden" name="tournamentId" value={t.id} />
                            <input type="hidden" name="action" value="clear" />
                            <button className="link-button" type="submit">clear</button>
                          </form>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {pageCount > 1 && (
            <div className="pager">
              <span>{total.toLocaleString()} tournaments</span>
              <div className="spacer" />
              {page > 1 && (
                <a href={`/periods/${period.id}?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page - 1}`}>‹ Prev</a>
              )}
              <span>page {page} of {pageCount}</span>
              {page < pageCount && (
                <a href={`/periods/${period.id}?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page + 1}`}>Next ›</a>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
