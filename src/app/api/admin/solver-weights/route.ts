import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { plannerJsonErrors, parseJsonBody } from "@/lib/api/validation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  DEFAULT_WEIGHTS,
  TEMPLATE_A_FACTORY_DEFAULTS,
  TEMPLATE_B_FACTORY_DEFAULTS,
  STRATEGY_SPECIFIC_KEYS,
  WEIGHT_KEYS,
  type WeightKey,
  type WeightMap,
  type WeightsConfig,
  parseWeightsConfig,
  pruneWeightsConfig,
  validateWeightsConfig,
} from "@/lib/solver/weights";

// ───────────────────────────────────────────────────────────────────────
// GET — full editor state. Returns both factory defaults AND any saved
// admin overrides, separated by zone (common / templateA / templateB).
// Frontend uses this to seed the 3-zone editor.
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

  const overrides = parseWeightsConfig(facility.solverWeightsJson);

  return NextResponse.json({
    factoryDefaults: DEFAULT_WEIGHTS,
    factoryTemplateA: TEMPLATE_A_FACTORY_DEFAULTS,
    factoryTemplateB: TEMPLATE_B_FACTORY_DEFAULTS,
    strategySpecificKeys: STRATEGY_SPECIFIC_KEYS,
    overrides, // { common?, templateA?, templateB? }
    updatedAt: facility.updatedAt.toISOString(),
  });
}

// ───────────────────────────────────────────────────────────────────────
// PUT — replace the override config for this facility. Validates that
// merged weights for BOTH strategies pass invariants. Hard-rejects on
// any violation.
// ───────────────────────────────────────────────────────────────────────

const weightMapSchema = z.record(z.string(), z.number().int());
const putSchema = z.object({
  common: weightMapSchema.optional(),
  templateA: weightMapSchema.optional(),
  templateB: weightMapSchema.optional(),
});

export async function PUT(request: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, putSchema);
  if (!parsed.ok) return parsed.response;

  // Filter each zone to its allowed keys (common = non-strategy keys;
  // templateA/B = strategy keys only). Unknown keys silently dropped.
  const validKeySet = new Set<string>(WEIGHT_KEYS);
  const strategyKeySet = new Set<string>(STRATEGY_SPECIFIC_KEYS);

  const filterCommon = (raw: Record<string, number> | undefined): WeightMap => {
    if (!raw) return {};
    const out: WeightMap = {};
    for (const [k, v] of Object.entries(raw)) {
      if (validKeySet.has(k) && !strategyKeySet.has(k)) {
        out[k as WeightKey] = v;
      }
    }
    return out;
  };
  const filterTemplate = (raw: Record<string, number> | undefined): WeightMap => {
    if (!raw) return {};
    const out: WeightMap = {};
    for (const [k, v] of Object.entries(raw)) {
      if (strategyKeySet.has(k)) {
        out[k as WeightKey] = v;
      }
    }
    return out;
  };

  const cleaned: WeightsConfig = {
    common: filterCommon(parsed.data.common),
    templateA: filterTemplate(parsed.data.templateA),
    templateB: filterTemplate(parsed.data.templateB),
  };

  // Validate merged result for BOTH strategies. Hard reject on any error.
  const errors = validateWeightsConfig(cleaned);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Ungültige Gewichte", violations: errors },
      { status: 400 },
    );
  }

  // Prune to differences-only for compact storage. Empty config → null.
  const pruned = pruneWeightsConfig(cleaned);
  const isEmpty =
    !pruned.common && !pruned.templateA && !pruned.templateB;
  const json = isEmpty ? null : JSON.stringify(pruned);

  const facilityId = session!.user.facilityId;
  await prisma.facility.update({
    where: { id: facilityId },
    data: { solverWeightsJson: json },
  });

  // Counts are useful for the success toast.
  const counts = {
    common: pruned.common ? Object.keys(pruned.common).length : 0,
    templateA: pruned.templateA ? Object.keys(pruned.templateA).length : 0,
    templateB: pruned.templateB ? Object.keys(pruned.templateB).length : 0,
  };
  return NextResponse.json({ ok: true, counts });
}
