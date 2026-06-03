import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentPeriod } from "@/lib/curation/currentPeriod";
import { normalizeEventName } from "@/lib/curation/normalize";
import { tournamentsInPeriodWhere } from "@/lib/curation/period";

const PAGE_SIZE = 50;

async function setRuleAction(formData: FormData): Promise<void> {
  "use server";
  const normalizedName = String(formData.get("normalizedName") ?? "");
  const action = String(formData.get("action") ?? ""); // "allow" | "deny" | "clear"
  const periodId = parseInt(String(formData.get("periodId") ?? ""), 10);
  if (!normalizedName) return;

  if (action === "clear") {
    await prisma.eventNameRule.deleteMany({ where: { normalizedName } });
  } else {
    const eligible = action === "allow";
    await prisma.eventNameRule.upsert({
      where: { normalizedName },
      create: {
        normalizedName,
        eligible,
        createdInPeriodId: Number.isFinite(periodId) ? periodId : null,
      },
      update: { eligible },
    });
  }
  revalidatePath("/curation/event-names");
}

interface SearchParams {
  status?: string; // "undecided" | "allowed" | "denied" | "all"
  page?: string;
}

interface EventGroup {
  normalizedName: string;
  sampleName: string;
  count: number;
}

export default async function EventNameQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const status = (sp.status ?? "undecided") as "undecided" | "allowed" | "denied" | "all";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const period = await getCurrentPeriod();

  if (!period) {
    return (
      <>
        <div className="crumbs">
          <Link href="/">Home</Link><span>/</span>
          <Link href="/curation">Curation</Link><span>/</span>
          <span>Event names</span>
        </div>
        <h2>Event name whitelist</h2>
        <div className="empty">
          No current ranking period. Pick one in <Link href="/periods">Ranking periods</Link>.
        </div>
      </>
    );
  }

  // Compute the candidate set: events whose tournament is in scope for the
  // current period, and (if the period has an event-type filter) of that type.
  // We do this in two queries: tournament ids in scope, then group events.
  const inScopeTournaments = await prisma.tournament.findMany({
    where: tournamentsInPeriodWhere(period.id, { startAt: period.startAt, endAt: period.endAt }),
    select: { id: true },
  });
  const tournamentIds = inScopeTournaments.map((t) => t.id);

  // Group events by name; we'll normalize in JS since SQLite lacks a portable
  // lowercase-and-collapse function. For a year's worth of events this is fast
  // (tens of thousands of rows; SQLite returns them in well under a second).
  const events = await prisma.event.findMany({
    where: {
      tournamentId: { in: tournamentIds },
      ...(period.eventType != null ? { type: period.eventType } : {}),
    },
    select: { name: true },
  });

  const groupMap = new Map<string, EventGroup>();
  for (const e of events) {
    const normalized = normalizeEventName(e.name);
    const existing = groupMap.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      groupMap.set(normalized, { normalizedName: normalized, sampleName: e.name, count: 1 });
    }
  }
  const allGroups = [...groupMap.values()].sort((a, b) => b.count - a.count);

  const rules = await prisma.eventNameRule.findMany({
    where: { normalizedName: { in: allGroups.map((g) => g.normalizedName) } },
  });
  const ruleByName = new Map(rules.map((r) => [r.normalizedName, r]));

  const filtered = allGroups.filter((g) => {
    const rule = ruleByName.get(g.normalizedName);
    if (status === "undecided") return !rule;
    if (status === "allowed") return rule?.eligible === true;
    if (status === "denied") return rule?.eligible === false;
    return true;
  });

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const undecidedCount = allGroups.filter((g) => !ruleByName.has(g.normalizedName)).length;
  const allowedCount = allGroups.filter((g) => ruleByName.get(g.normalizedName)?.eligible === true).length;
  const deniedCount = allGroups.filter((g) => ruleByName.get(g.normalizedName)?.eligible === false).length;

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link><span>/</span>
        <Link href="/curation">Curation</Link><span>/</span>
        <span>Event names</span>
      </div>

      <h2>Event name whitelist</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        Distinct event names occurring in {period.name}, sorted by frequency. Default-deny:
        an event whose name is not whitelisted will be ineligible for ranking.
        Rules are <strong>global</strong> — allowing "melee singles" here applies to every period.
      </p>

      <div className="tabs">
        <Link href="/curation/event-names?status=undecided" className={status === "undecided" ? "tab active" : "tab"}>
          undecided <span className="muted">({undecidedCount.toLocaleString()})</span>
        </Link>
        <Link href="/curation/event-names?status=allowed" className={status === "allowed" ? "tab active" : "tab"}>
          allowed <span className="muted">({allowedCount.toLocaleString()})</span>
        </Link>
        <Link href="/curation/event-names?status=denied" className={status === "denied" ? "tab active" : "tab"}>
          denied <span className="muted">({deniedCount.toLocaleString()})</span>
        </Link>
        <Link href="/curation/event-names?status=all" className={status === "all" ? "tab active" : "tab"}>
          all
        </Link>
      </div>

      {visible.length === 0 ? (
        <div className="empty">Nothing to show.</div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Normalized name</th>
                <th>Sample raw name</th>
                <th>Occurrences</th>
                <th>Current rule</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => {
                const rule = ruleByName.get(g.normalizedName);
                return (
                  <tr key={g.normalizedName}>
                    <td className="mono">{g.normalizedName}</td>
                    <td>{g.sampleName}</td>
                    <td>{g.count.toLocaleString()}</td>
                    <td>
                      {rule == null ? (
                        <span className="muted">undecided</span>
                      ) : rule.eligible ? (
                        <span style={{ color: "var(--winner)", fontWeight: 600 }}>allowed</span>
                      ) : (
                        <span style={{ color: "var(--loser)", fontWeight: 600 }}>denied</span>
                      )}
                    </td>
                    <td className="row-actions" style={{ whiteSpace: "nowrap" }}>
                      <form action={setRuleAction} style={{ display: "inline" }}>
                        <input type="hidden" name="normalizedName" value={g.normalizedName} />
                        <input type="hidden" name="periodId" value={period.id} />
                        <input type="hidden" name="action" value="allow" />
                        <button className="link-button" type="submit" disabled={rule?.eligible === true}>allow</button>
                      </form>
                      <span className="muted"> · </span>
                      <form action={setRuleAction} style={{ display: "inline" }}>
                        <input type="hidden" name="normalizedName" value={g.normalizedName} />
                        <input type="hidden" name="periodId" value={period.id} />
                        <input type="hidden" name="action" value="deny" />
                        <button className="link-button" type="submit" disabled={rule?.eligible === false}>deny</button>
                      </form>
                      {rule && (
                        <>
                          <span className="muted"> · </span>
                          <form action={setRuleAction} style={{ display: "inline" }}>
                            <input type="hidden" name="normalizedName" value={g.normalizedName} />
                            <input type="hidden" name="periodId" value={period.id} />
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
              <span>{total.toLocaleString()} groups</span>
              <div className="spacer" />
              {page > 1 && <a href={`/curation/event-names?status=${status}&page=${page - 1}`}>‹ Prev</a>}
              <span>page {page} of {pageCount}</span>
              {page < pageCount && <a href={`/curation/event-names?status=${status}&page=${page + 1}`}>Next ›</a>}
            </div>
          )}
        </>
      )}
    </>
  );
}
