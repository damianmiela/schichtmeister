import { NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { markGenerationCancelled } from "@/lib/schedule/generationCancelState";

type RouteCtx = { params: Promise<{ id: string }> };

const SOLVER_URL = process.env.SOLVER_URL ?? "http://solver:8000";

/**
 * Cancel a currently-running schedule generation.
 *
 * Looks up the in-process registrations for this schedule's generations
 * (usually one), then for each:
 *   1. Forwards the cancel signal to the Python solver via
 *      POST {SOLVER_URL}/cancel/{cancelKey} so CP-SAT stops the current
 *      search and returns its best feasible solution found so far.
 *   2. Sets a local flag so the generate-stream race loop also bails out
 *      and doesn't kick off any further races (Mehrfach-Lauf only).
 *
 * The generate-stream endpoint then proceeds with the best-so-far run
 * and saves it normally — the SSE stream stays open until the saving is
 * done. If no feasible solution had been found yet at cancel time, the
 * route emits an error event and leaves the schedule unchanged.
 */
export async function POST(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId } = await context.params;
  const facilityId = session!.user.facilityId;

  // Confirm the schedule belongs to the user's facility (defense in depth).
  const exists = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const cancelKeys = markGenerationCancelled(scheduleId);
  if (cancelKeys.length === 0) {
    // No generation currently running for this schedule.
    return NextResponse.json(
      { ok: false, reason: "no_active_generation" },
      { status: 409 },
    );
  }

  // Forward the signal to the Python solver. Best-effort — even if this
  // call fails, the local flag still prevents new races from starting.
  for (const cancelKey of cancelKeys) {
    try {
      const r = await fetch(
        `${SOLVER_URL}/cancel/${encodeURIComponent(cancelKey)}`,
        { method: "POST", signal: AbortSignal.timeout(5_000) },
      );
      if (!r.ok) {
        console.warn(
          `[cancel-generation] Solver returned ${r.status} for cancel key`,
        );
      }
    } catch (e) {
      console.warn("[cancel-generation] Solver unreachable for cancel:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
