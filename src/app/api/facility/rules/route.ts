import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { registerBuiltInPlanningRules, getRegisteredRules } from "@/lib/planning";
import { defaultPlanningRulesConfig, mergePlanningRules } from "@/lib/planning";

registerBuiltInPlanningRules();

type RuleOverrides = Record<string, { enabled?: boolean; params?: Record<string, unknown> }>;

function parseOverrides(json: string | null): RuleOverrides {
  if (!json) return {};
  try {
    return JSON.parse(json) as RuleOverrides;
  } catch {
    return {};
  }
}

export async function GET() {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: session!.user.facilityId },
  });

  const snapshot = mergePlanningRules(facility, defaultPlanningRulesConfig);
  const descriptors = getRegisteredRules();

  const rules = descriptors.map((d) => {
    const state = snapshot.ruleStates[d.id];
    return {
      id: d.id,
      description: d.description,
      severity: d.severity,
      scope: d.scope,
      enabled: state?.enabled ?? false,
      params: state?.params ?? {},
    };
  });

  return NextResponse.json({
    minRestHours: snapshot.minRestHours,
    miniJobMaxMonthlyHours: snapshot.miniJobMaxMonthlyHours,
    rules,
  });
}

const patchSchema = z.object({
  minRestHours: z.number().min(0).optional(),
  miniJobMaxMonthlyHours: z.number().min(0).optional(),
  ruleOverrides: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

export async function PATCH(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  const { minRestHours, miniJobMaxMonthlyHours, ruleOverrides } = parsed.data;

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: session!.user.facilityId },
  });

  const currentOverrides = parseOverrides(facility.ruleOverridesJson);
  const mergedOverrides = ruleOverrides
    ? { ...currentOverrides, ...ruleOverrides }
    : currentOverrides;

  const updated = await prisma.facility.update({
    where: { id: facility.id },
    data: {
      ...(minRestHours !== undefined && { minRestHours }),
      ...(miniJobMaxMonthlyHours !== undefined && { miniJobMaxMonthlyHours }),
      ...(ruleOverrides !== undefined && {
        ruleOverridesJson: JSON.stringify(mergedOverrides),
      }),
    },
  });

  const snapshot = mergePlanningRules(updated, defaultPlanningRulesConfig);
  const descriptors = getRegisteredRules();
  const rules = descriptors.map((d) => {
    const state = snapshot.ruleStates[d.id];
    return {
      id: d.id,
      description: d.description,
      severity: d.severity,
      scope: d.scope,
      enabled: state?.enabled ?? false,
      params: state?.params ?? {},
    };
  });

  return NextResponse.json({
    minRestHours: snapshot.minRestHours,
    miniJobMaxMonthlyHours: snapshot.miniJobMaxMonthlyHours,
    rules,
  });
}
