import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { plannerJsonErrors } from "@/lib/api/validation";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/admin/clean-absences
 *
 * Deletes all EmployeeAbsence records for the current facility.
 * These are legacy records from the old employee-profile absence UI
 * or from earlier code that persisted generation-modal absences.
 * Now absences are only stored as K/U assignment records.
 */
export async function POST() {
  const { session, error } = await requireAdmin();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;

  // Find all employee IDs in this facility
  const employees = await prisma.employee.findMany({
    where: { facilityId },
    select: { id: true },
  });
  const empIds = employees.map((e) => e.id);

  if (empIds.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  const result = await prisma.employeeAbsence.deleteMany({
    where: { employeeId: { in: empIds } },
  });

  return NextResponse.json({ deleted: result.count });
}
