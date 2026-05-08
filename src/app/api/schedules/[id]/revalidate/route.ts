import { NextRequest, NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import { formatRuleViolations } from "@/lib/schedule/formatRuleViolations";
import type { AbsenceInput, AssignmentInput, RuleMessage } from "@/lib/planning/types";

type RouteCtx = { params: Promise<{ id: string }> };

const SHIFT_DE: Record<string, string> = {
  EARLY: "Frühdienst",
  LATE: "Spätdienst",
  NIGHT: "Nachtdienst",
  BL: "Bereichsleitung",
};

function buildWarningsByDay(
  messages: RuleMessage[],
  empNames: Map<string, string>,
  out: Record<string, string[]>,
) {
  const isoRe = /\d{4}-\d{2}-\d{2}/g;

  function addDay(iso: string, desc: string) {
    (out[iso] ??= []).push(desc);
  }

  function empName(ids?: string[]): string {
    if (!ids?.length) return "";
    return ids.map((id) => empNames.get(id) ?? id).join(", ");
  }

  for (const msg of messages) {
    const dates: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = isoRe.exec(msg.message)) !== null) dates.push(m[0]);
    if (dates.length === 0) continue;

    let desc: string;
    switch (msg.code) {
      case "UNDERSTAFFED": {
        const st = msg.message.match(/for (\w+) station/)?.[1] ?? "";
        const stn = msg.message.match(/station (\d+)/)?.[1] ?? "";
        desc = `Unterbesetzung ${SHIFT_DE[st] ?? st} Station ${stn}`;
        break;
      }
      case "OVERSTAFFED": {
        const st = msg.message.match(/(\w+) station/)?.[1] ?? "";
        const stn = msg.message.match(/station (\d+)/)?.[1] ?? "";
        desc = `Überbesetzung ${SHIFT_DE[st] ?? st} Station ${stn}`;
        break;
      }
      case "MISSING_QUALIFICATION": {
        const tag = msg.message.match(/tag "([^"]+)"/)?.[1] ?? "";
        const st = msg.message.match(/for (\w+) station/)?.[1] ?? "";
        const stn = msg.message.match(/station (\d+)/)?.[1] ?? "";
        desc = `Qualifikation "${tag}" fehlt — ${SHIFT_DE[st] ?? st} Station ${stn}`;
        break;
      }
      case "OVERLAP": {
        desc = `Schichtüberlappung: ${empName(msg.employeeIds)}`;
        break;
      }
      case "INSUFFICIENT_REST": {
        desc = `Ruhezeit unterschritten: ${empName(msg.employeeIds)}`;
        break;
      }
      case "ABSENCE_CONFLICT": {
        desc = `Abwesenheitskonflikt: ${empName(msg.employeeIds)}`;
        break;
      }
      case "STATION_COVERAGE_GAP": {
        const stn = msg.message.match(/Station (\d+)/)?.[1] ?? "";
        desc = `Abdeckungslücke Station ${stn}`;
        break;
      }
      case "INSUFFICIENT_REST_AFTER_MAX_DAYS": {
        desc = `Fehlende Ruhetage: ${empName(msg.employeeIds)}`;
        break;
      }
      case "ALTERNATING_WEEKEND_VIOLATION": {
        desc = `Wochenendregelung: ${empName(msg.employeeIds)}`;
        break;
      }
      case "BL_WEEKEND_HOLIDAY": {
        desc = `BL am Wochenende/Feiertag: ${empName(msg.employeeIds)}`;
        break;
      }
      default: {
        desc = msg.code;
        break;
      }
    }

    for (const iso of dates) addDay(iso, desc);
  }

  // Deduplicate per day
  for (const iso of Object.keys(out)) {
    out[iso] = [...new Set(out[iso])];
  }
}

/**
 * POST /api/schedules/[id]/revalidate?employeeId=xxx
 *
 * Re-runs the full validation engine on the current assignments and
 * saves updated warnings to the schedule. Called when the schedule page
 * is opened so warnings stay up-to-date after day-view edits.
 *
 * If `employeeId` query param is provided, returns ONLY warnings that
 * involve that specific employee (filtered at the RuleMessage level
 * before formatting).
 */
export async function POST(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId } = await context.params;
  const facilityId = session!.user.facilityId;
  const employeeIdFilter = request.nextUrl.searchParams.get("employeeId");

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Dienstplan nicht gefunden." }, { status: 404 });
  }

  const allRows = await prisma.assignment.findMany({
    where: { scheduleId },
  });

  // Separate real shifts from absence/status markers (K, U, FREI, etc.)
  const ABSENCE_STATUSES = new Set(["K", "U", "LZ", "MS", "KU"]);
  const assignmentInputs: AssignmentInput[] = [];
  const dayStatusRows: { employeeId: string; date: Date; dayStatus: string }[] = [];

  for (const a of allRows) {
    if (a.dayStatus) {
      dayStatusRows.push({ employeeId: a.employeeId, date: a.date, dayStatus: a.dayStatus });
    } else {
      if (!a.shiftProfileId) continue; // skip pure absence rows
      assignmentInputs.push({
        id: a.id,
        date: a.date,
        shiftProfileId: a.shiftProfileId,
        employeeId: a.employeeId,
        ...(a.stationNumber != null && a.stationNumber >= 1 && a.stationNumber <= 3 && { stationNumber: a.stationNumber }),
      } as AssignmentInput);
    }
  }

  // Build synthetic per-day absences from dayStatus markers so the sollDelta
  // rule can reduce Soll correctly (these complement EmployeeAbsence DB records)
  const extraAbsences: AbsenceInput[] = dayStatusRows
    .filter((r) => ABSENCE_STATUSES.has(r.dayStatus))
    .map((r) => ({
      employeeId: r.employeeId,
      startDate: r.date,
      endDate: r.date,
      type: r.dayStatus === "K" ? "KRANK" : "URLAUB",
    }));

  const v = await validateScheduleAssignments(
    prisma,
    facilityId,
    { periodStart: schedule.periodStart, periodEnd: schedule.periodEnd },
    assignmentInputs,
    { extraAbsences },
  );

  let warningStrings: import("@/lib/schedule/formatRuleViolations").FormattedWarning[] = [];
  let employeeWarnings: import("@/lib/schedule/formatRuleViolations").FormattedWarning[] | undefined;
  const warningsByDay: Record<string, string[]> = {};

  if (v.ok) {
    const allMessages = [...v.result.errors, ...v.result.warnings];
    if (allMessages.length > 0) {
      const emps = await prisma.employee.findMany({
        where: { facilityId },
        select: { id: true, firstName: true, lastName: true },
      });
      const empNames = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

      // Full warnings for schedule storage
      warningStrings = formatRuleViolations(allMessages, empNames);

      // Build per-day warning descriptions from raw rule messages
      buildWarningsByDay(allMessages, empNames, warningsByDay);

      // Employee-specific warnings if requested
      if (employeeIdFilter) {
        const empMessages = allMessages.filter(
          (msg) => msg.employeeIds?.includes(employeeIdFilter),
        );
        employeeWarnings = empMessages.length > 0
          ? formatRuleViolations(empMessages, empNames)
          : [];
      }
    }
  }

  await prisma.schedule.update({
    where: { id: scheduleId },
    data: { warningsJson: warningStrings.length > 0 ? JSON.stringify(warningStrings) : null },
  });

  // Keep the currently-active version's warningCount in sync with the fresh
  // schedule.warningsJson so the "Aktuell" chip in the versions drawer always
  // matches the badge count on the main view. Historical (non-current) versions
  // keep their original snapshot-time count and are not touched here.
  if (schedule.currentVersionId) {
    await prisma.scheduleVersion.updateMany({
      where: { id: schedule.currentVersionId, scheduleId },
      data: { warningCount: warningStrings.reduce((sum, w) => sum + w.count, 0) },
    });
  }

  return NextResponse.json({
    warnings: warningStrings,
    warningsByDay,
    ...(employeeWarnings !== undefined && { employeeWarnings }),
  });
}
