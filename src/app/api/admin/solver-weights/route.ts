import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { plannerJsonErrors, parseJsonBody } from "@/lib/api/validation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  DEFAULT_WEIGHTS,
  WEIGHT_KEYS,
  type WeightKey,
  type WeightMap,
  validateWeights,
  parseStoredWeights,
  pruneToOverrides,
} from "@/lib/solver/weights";

// ───────────────────────────────────────────────────────────────────────
// GET — return defaults + currently saved overrides for this facility.
// Frontend uses this to seed the form.
// ───────────────────────────────────────────────────────────────────────
export async function GET() {
  const { session, error } = await requireAdmin();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { solverWeightsJson: true, updatedAt: true },
  });

  const overrides = parseStoredWeights(facility.solverWeightsJson);

  return NextResponse.json({
    defaults: DEFAULT_WEIGHTS,
    overrides,
    updatedAt: facility.updatedAt.toISOString(),
  });
}

// ───────────────────────────────────────────────────────────────────────
// PUT — replace the override map for this facility. Validates against
// the same rules as the Python solver. Hard-rejects on any violation.
// ───────────────────────────────────────────────────────────────────────

// Loose schema (any key, integer value). We DO our own deep validation
// against WEIGHT_KEYS + invariants below, so zod just gates the shape.
const putSchema = z.object({
  weights: z.record(z.string(), z.number().int()),
});

export async function PUT(request: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, putSchema);
  if (!parsed.ok) return parsed.response;

  // Filter to known keys only — silently drops unknown fields.
  const validKeySet = new Set<string>(WEIGHT_KEYS);
  const cleaned: WeightMap = {};
  for (const [k, v] of Object.entries(parsed.data.weights)) {
    if (validKeySet.has(k)) cleaned[k as WeightKey] = v;
  }

  // Run the same validation the frontend ran. Hard reject on any
  // violation — admin or not, math-breaking sets are not allowed.
  const errors = validateWeights(cleaned);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Ungültige Gewichte", violations: errors },
      { status: 400 },
    );
  }

  // Store only fields that DIFFER from the default — keeps the JSON
  // small and makes "is anything overridden?" a trivial check later.
  const pruned = pruneToOverrides(cleaned);
  const json = Object.keys(pruned).length > 0 ? JSON.stringify(pruned) : null;

  const facilityId = session!.user.facilityId;
  await prisma.facility.update({
    where: { id: facilityId },
    data: { solverWeightsJson: json },
  });

  return NextResponse.json({
    ok: true,
    overrideCount: Object.keys(pruned).length,
  });
}
