import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import type { UserRole } from "@prisma/client";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireAuth() {
  const session = await getSession();
  if (!session?.user?.id) {
    return { session: null, error: "UNAUTHORIZED" as const };
  }
  return { session, error: null };
}

export async function requirePlanner() {
  const result = await requireAuth();
  if (result.error) return result;
  if (result.session!.user.role !== "PLANNER") {
    return { session: null, error: "FORBIDDEN" as const };
  }
  return { session: result.session, error: null };
}

export function isPlannerRole(role: UserRole) {
  return role === "PLANNER";
}
