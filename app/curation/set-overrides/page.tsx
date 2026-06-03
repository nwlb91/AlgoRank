import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

async function clearOverrideAction(formData: FormData): Promise<void> {
  "use server";
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return;
  await prisma.setOverride.delete({ where: { id } });
  revalidatePath("/curation/set-overrides");
}

export default async function SetOverridesPage() {
  const overrides = await prisma.setOverride.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      set: { include: { event: { include: { tournament: true } } } },
      correctedWinnerEntrant: true,
      createdInPeriod: true,
    },
    take: 200,
  });

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link><span>/</span>
        <Link href="/curation">Curation</Link><span>/</span>
        <span>Set overrides</span>
      </div>
      <h2>Set overrides</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        Exclusions and result corrections. The original Set row is never mutated — the bracket
        viz and set page show "result was X, overwritten to Y because Z." Set new ones from
        the set page.
      </p>

      {overrides.length === 0 ? (
        <div className="empty">No overrides yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Set</th>
              <th>Event</th>
              <th>Date</th>
              <th>Kind</th>
              <th>Corrected winner</th>
              <th>Reason</th>
              <th>From period</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/sets/${o.set.id}`}>#{o.set.identifier ?? o.set.id}</Link></td>
                <td><Link href={`/events/${o.set.event.id}`}>{o.set.event.name}</Link></td>
                <td className="mono">{formatDate(o.set.completedAt)}</td>
                <td>
                  {o.kind === "EXCLUDE" ? (
                    <span style={{ color: "var(--loser)", fontWeight: 600 }}>EXCLUDE</span>
                  ) : (
                    <span style={{ color: "var(--warn)", fontWeight: 600 }}>CORRECT</span>
                  )}
                </td>
                <td>{o.correctedWinnerEntrant?.name ?? <span className="muted">—</span>}</td>
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
