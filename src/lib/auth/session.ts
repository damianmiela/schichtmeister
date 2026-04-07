import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/db/prisma";
import type { UserRole } from "@prisma/client";

export async function getSession() {
  return getServerSession(authOptions);
}

/**
 * Throttled last-activity tracker.
 * Updates lastActiveAt at most once per 60 seconds per user to avoid DB spam.
 */
const lastActivityMap = new Map<string, number>();
const ACTIVITY_THROTTLE_MS = 60_000; // 1 minute

function touchActivity(userId: string) {
  const now = Date.now();
  const last = lastActivityMap.get(userId) ?? 0;
  if (now - last < ACTIVITY_THROTTLE_MS) return;
  lastActivityMap.set(userId, now);
  // Fire and forget — don't await
  void prisma.user.update({
    where: { id: userId },
    data: { lastActiveAt: new Date() },
  }).catch(() => {/* ignore */});
}

export async function requireAuth() {
  const session = await getSession();
  if (!session?.user?.id) {
    return { session: null, error: "UNAUTHORIZED" as const };
  }
  // Track activity
  touchActivity(session.user.id);
  return { session, error: null };
}

/** Requires PLANNER or ADMIN role (ADMIN inherits all planner permissions). */
export async function requirePlanner() {
  const result = await requireAuth();
  if (result.error) return result;
  const role = result.session!.user.role;
  if (role !== "PLANNER" && role !== "ADMIN") {
    return { session: null, error: "FORBIDDEN" as const };
  }
  return { session: result.session, error: null };
}

/** Requires ADMIN role only. */
export async function requireAdmin() {
  const result = await requireAuth();
  if (result.error) return result;
  if (result.session!.user.role !== "ADMIN") {
    return { session: null, error: "FORBIDDEN" as const };
  }
  return { session: result.session, error: null };
}

export function isPlannerRole(role: UserRole) {
  return role === "PLANNER" || role === "ADMIN";
}

export function isAdminRole(role: UserRole) {
  return role === "ADMIN";
}
