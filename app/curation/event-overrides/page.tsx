import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

async function clearOverrideAction(formData: FormData): Promise<void> {
  "use server";
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return;
  await prisma.eventEligibilityOverride.delete({ where: { id } });
  revalidatePath("/curation/event-overrides");
}

export default async function EventOverridesPage() {
  const overrides = await prisma.eventEligibilityOverride.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      event: { include: { tournament: true } },
      createdInPeriod: true,
    },
    take: 200,
  });

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link><span>/</span>
        <Link href="/curation">Curation</Link><span>/</span>
        <span>Event eligibility overrides</span>
      </div>
      <h2>Event eligibility overrides</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        Per-event overrides take precedence over the global name-rule whitelist. Use these for events
        whose name matches an allowed rule but shouldn't count (and vice versa). Set new ones from
        the event page.
      </p>

      {overrides.length === 0 ? (
        <div className="empty">No overrides yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Tournament</th>
              <th>Date</th>
              <th>Override</th>
              <th>Reason</th>
              <th>From period</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/events/${o.event.id}`}>{o.event.name}</Link></td>
                <td>
                  {o.event.tournament.slug ? (
                    <Link href={`/tournaments/${encodeURIComponent(o.event.tournament.slug)}`}>{o.event.tournament.name}</Link>
                  ) : (
                    o.event.tournament.name
                  )}
                </td>
                <td className="mono">{formatDate(o.event.startAt)}</td>
                <td>
                  {o.eligible ? (
                    <span style={{ color: "var(--winner)", fontWeight: 600 }}>force eligible</span>
                  ) : (
                    <span style={{ color: "var(--loser)", fontWeight: 600 }}>force ineligible</span>
                  )}
                </td>
                <td>{o.reason}</td>
                <td>
                  {o.createdInPeriod ? <Link href={`/periods/${o.createdInPeriod.id}`}>{o.createdInPeriod.name}</Link> : <span className="muted">—</span>}
                </td>
                <td className="row-actions">
                  <form action={clearOverrideAction} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={o.id} />
                    <button className="link-button" type="submit">clear</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
