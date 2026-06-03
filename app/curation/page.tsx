import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentPeriod } from "@/lib/curation/currentPeriod";
import { formatDate } from "@/lib/format";

export default async function CurationHomePage() {
  const period = await getCurrentPeriod();
  if (!period) {
    return (
      <>
        <div className="crumbs">
          <Link href="/">Home</Link><span>/</span><span>Curation</span>
        </div>
        <h2>Curation</h2>
        <div className="empty">
          No current ranking period selected. Visit <Link href="/periods">Ranking periods</Link> to pick one.
        </div>
      </>
    );
  }

  const [
    nameRuleCount,
    eventOverrideCount,
    setOverrideCount,
  ] = await Promise.all([
    prisma.eventNameRule.count(),
    prisma.eventEligibilityOverride.count(),
    prisma.setOverride.count(),
  ]);

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link><span>/</span><span>Curation</span>
      </div>
      <h2>Curation</h2>
      <div className="card">
        <div className="metagrid">
          <div><span className="label">Current period: </span><Link href={`/periods/${period.id}`}>{period.name}</Link></div>
          <div><span className="label">Window: </span>{formatDate(period.startAt)} → {formatDate(period.endAt)}</div>
          <div><span className="label">Event type: </span>{period.eventType === 1 ? "Singles" : period.eventType === 5 ? "Doubles" : "any"}</div>
        </div>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
          Decisions you make here are <strong>global</strong> — they apply to every ranking computation,
          past and future. The period above scopes the review queue (what's surfaced for your attention)
          and tags each decision with provenance.
        </p>
      </div>

      <h3>Queues</h3>
      <div className="queue-grid">
        <Link href="/curation/event-names" className="queue-card">
          <h4>Event name whitelist</h4>
          <p>Decide which event names count as eligible for ranking. Default-deny — events whose normalized name isn't whitelisted are skipped.</p>
          <p className="muted">{nameRuleCount.toLocaleString()} rules so far</p>
        </Link>
        <Link href="/curation/event-overrides" className="queue-card">
          <h4>Event eligibility overrides</h4>
          <p>Per-event escape hatches when the name rule gets it wrong.</p>
          <p className="muted">{eventOverrideCount.toLocaleString()} overrides so far</p>
        </Link>
        <Link href="/curation/set-overrides" className="queue-card">
          <h4>Set overrides</h4>
          <p>Excluded sets and result corrections, applied per set from anywhere a set is shown.</p>
          <p className="muted">{setOverrideCount.toLocaleString()} overrides so far</p>
        </Link>
      </div>
    </>
  );
}
