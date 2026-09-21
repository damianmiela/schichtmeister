import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { plannerJsonErrors } from "@/lib/api/validation";
import { prisma } from "@/lib/db/prisma";

/** Models the database viewer can browse. */
const MODELS = [
  "facility",
  "user",
  "passwordResetToken",
  "employee",
  "employeeAvailability",
  "employeeWorkProfile",
  "shiftProfile",
  "staffingRequirement",
  "qualificationRequirement",
  "schedule",
  "assignment",
  "wish",
  "swapRequest",
  "auditLog",
  "qualification",
  "employeeAbsence",
] as const;

const MODEL_LABELS: Record<string, string> = {
  facility: "Facility",
  user: "User",
  passwordResetToken: "PasswordResetToken",
  employee: "Employee",
  employeeAvailability: "EmployeeAvailability",
  employeeWorkProfile: "EmployeeWorkProfile",
  shiftProfile: "ShiftProfile",
  staffingRequirement: "StaffingRequirement",
  qualificationRequirement: "QualificationRequirement",
  schedule: "Schedule",
  assignment: "Assignment",
  wish: "Wish",
  swapRequest: "SwapRequest",
  auditLog: "AuditLog",
  qualification: "Qualification",
  employeeAbsence: "EmployeeAbsence",
};

/** Prisma has no typed access by model name, so narrow each delegate to the two calls used here. */
type ModelDelegate = {
  count: () => Promise<number>;
  findMany: (args: object) => Promise<Record<string, unknown>[]>;
};

function delegateFor(model: string): ModelDelegate {
  return (prisma as unknown as Record<string, ModelDelegate>)[model];
}

/** GET /api/admin/database?table=user&page=1&pageSize=20 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(5, Number(searchParams.get("pageSize") || 20)));

  // If no table specified, return list of tables with counts
  if (!table) {
    const tables = await Promise.all(
      MODELS.map(async (model) => {
        try {
          const count = await delegateFor(model).count();
          return { model, label: MODEL_LABELS[model] || model, count };
        } catch {
          return { model, label: MODEL_LABELS[model] || model, count: 0 };
        }
      }),
    );
    return NextResponse.json({ tables });
  }

  // Validate table name
  if (!MODELS.includes(table as (typeof MODELS)[number])) {
    return NextResponse.json({ error: "Ungültige Tabelle" }, { status: 400 });
  }

  try {
    const delegate = delegateFor(table);
    const [rows, total] = await Promise.all([
      delegate.findMany({
        take: pageSize,
        skip: (page - 1) * pageSize,
        orderBy: { createdAt: "desc" } as Record<string, string>,
      }),
      delegate.count(),
    ]);

    // Get column names from first row, or empty
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return NextResponse.json({
      table,
      label: MODEL_LABELS[table] || table,
      columns,
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch {
    // Some models don't have createdAt — retry without ordering
    try {
      const delegate = delegateFor(table);
      const [rows, total] = await Promise.all([
        delegate.findMany({
          take: pageSize,
          skip: (page - 1) * pageSize,
        }),
        delegate.count(),
      ]);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return NextResponse.json({
        table,
        label: MODEL_LABELS[table] || table,
        columns,
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (e2) {
      console.error(`[DB BROWSER] Error reading table ${table}:`, e2);
      return NextResponse.json({ error: "Tabelle konnte nicht gelesen werden" }, { status: 500 });
    }
  }
}
