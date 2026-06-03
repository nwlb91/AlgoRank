import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { setCurrentPeriodId, getCurrentPeriodId } from "@/lib/curation/currentPeriod";
import { formatDate } from "@/lib/format";

async function createPeriodAction(formData: FormData): Promise<void> {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "custom");
  const startAt = parseDateInput(String(formData.get("startAt") ?? ""));
  const endAt = parseDateInput(String(formData.get("endAt") ?? ""), { endOfDay: true });
  const eventTypeRaw = String(formData.get("eventType") ?? "");
  const eventType = eventTypeRaw === "" ? null : parseInt(eventTypeRaw, 10);

  if (!name || !startAt || !endAt) {
    throw new Error("name, startAt, and endAt are required");
  }
  if (startAt >= endAt) throw new Error("startAt must be before endAt");

  const period = await prisma.rankingPeriod.create({
    data: {
      name,
      kind,
      startAt,
      endAt,
      videogameId: 1, // Melee — see PLAN.md §3
      eventType,
    },
  });
  await setCurrentPeriodId(period.id);
  revalidatePath("/periods");
  redirect(`/periods/${period.id}`);
}

async function selectPeriodAction(formData: FormData): Promise<void> {
  "use server";
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) return;
  await setCurrentPeriodId(id);
  revalidatePath("/");
  redirect(`/periods/${id}`);
}

export default async function PeriodsPage() {
  const [periods, currentId] = await Promise.all([
    prisma.rankingPeriod.findMany({
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      include: {
        _count: {
          select: {
            tournamentInclusions: true,
            eventNameRules: true,
            eventEligibilityOverrides: true,
            setOverrides: true,
          },
        },
      },
    }),
    getCurrentPeriodId(),
  ]);

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link><span>/</span><span>Ranking periods</span>
      </div>

      <h2>Ranking periods</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        A period is a lens for curation work. Decisions (event whitelists, set overrides) made
        while curating one period apply globally — the period only tags provenance and scopes
        review queues. Pick one to make it the current curation context.
      </p>

      {periods.length === 0 ? (
        <div className="empty">No periods yet — create one below to start curating.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Window</th>
              <th>Event type</th>
              <th>Tournament rules</th>
              <th>Name rules</th>
              <th>Event overrides</th>
              <th>Set overrides</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} style={p.id === currentId ? { background: "var(--surface-2)" } : undefined}>
                <td>
                  <Link href={`/periods/${p.id}`}>{p.name}</Link>
                  {p.id === currentId && <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>current</span>}
                </td>
                <td><span className="badge">{p.kind}</span></td>
                <td className="mono">{formatDate(p.startAt)} → {formatDate(p.endAt)}</td>
                <td>{p.eventType === 1 ? "Singles" : p.eventType === 5 ? "Doubles" : "any"}</td>
                <td>{p._count.tournamentInclusions}</td>
                <td>{p._count.eventNameRules}</td>
                <td>{p._count.eventEligibilityOverrides}</td>
                <td>{p._count.setOverrides}</td>
                <td className="row-actions">
                  {p.id !== currentId && (
                    <form action={selectPeriodAction} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="link-button">make current</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 28 }}>New period</h3>
      <form action={createPeriodAction} className="form-grid">
        <label>
          <span>Name</span>
          <input type="text" name="name" placeholder="e.g. 2025 Yearly" required />
        </label>
        <label>
          <span>Kind</span>
          <select name="kind" defaultValue="yearly">
            <option value="yearly">yearly</option>
            <option value="summer">summer</option>
            <option value="custom">custom</option>
          </select>
        </label>
        <label>
          <span>Start (UTC)</span>
          <input type="date" name="startAt" required />
        </label>
        <label>
          <span>End (UTC)</span>
          <input type="date" name="endAt" required />
        </label>
        <label>
          <span>Event type</span>
          <select name="eventType" defaultValue="1">
            <option value="1">Singles</option>
            <option value="5">Doubles</option>
            <option value="">any</option>
          </select>
        </label>
        <button type="submit">Create</button>
      </form>
    </>
  );
}

function parseDateInput(s: string, opts: { endOfDay?: boolean } = {}): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T${opts.endOfDay ? "23:59:59" : "00:00:00"}Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}
