import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { parseIsoDateOnly, toIsoDateOnly } from "@/lib/api/dateOnly";
import { shiftIntervalMs, assignmentPaidHours, utcDayKey, utcMonthKey } from "@/lib/planning/time";
import { mergePlanningRules } from "@/lib/planning/merge";
import { defaultPlanningRulesConfig } from "@/lib/planning/defaultConfig";
import type { RuleMessage } from "@/lib/planning/types";

const checkBodySchema = z.object({
  scheduleId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftProfileId: z.string().min(1),
  employeeId: z.string().min(1),
  /** When replacing, remove this assignment before appending the proposed one. */
  replaceAssignmentId: z.string().optional(),
});

/**
 * Targeted rule validation for a proposed assignment.
 * Only checks rules relevant to THIS employee on THIS day/shift —
 * not the entire schedule period.
 *
 * Returns errors (hard violations) + warnings (soft violations).
 */
export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, checkBodySchema);
  if (!parsed.ok) return parsed.response;

  const facilityId = session!.user.facilityId;
  const date = parseIsoDateOnly(parsed.data.date);
  if (!date) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }

  const [schedule, facility, employee, profile, allProfiles, allAssignments, staffingRows] =
    await Promise.all([
      prisma.schedule.findFirst({ where: { id: parsed.data.scheduleId, facilityId } }),
      prisma.facility.findUnique({ where: { id: facilityId } }),
      prisma.employee.findFirst({
        where: { id: parsed.data.employeeId, facilityId },
        include: {
          allowedShiftProfiles: { select: { id: true } },
          qualifications: { select: { abbreviation: true } },
        },
      }),
      prisma.shiftProfile.findFirst({ where: { id: parsed.data.shiftProfileId, facilityId } }),
      prisma.shiftProfile.findMany({ where: { facilityId } }),
      prisma.assignment.findMany({ where: { scheduleId: parsed.data.scheduleId } }),
      prisma.staffingRequirement.findMany({
        where: { facilityId },
        include: { qualificationRequirements: true },
      }),
    ]);

  if (!schedule) {
    return NextResponse.json({ error: "Dienstplan nicht gefunden." }, { status: 404 });
  }
  if (!facility) {
    return NextResponse.json({ error: "Einrichtung nicht gefunden." }, { status: 404 });
  }
  if (!employee) {
    return NextResponse.json({ error: "Mitarbeiter nicht gefunden." }, { status: 404 });
  }
  if (!profile) {
    return NextResponse.json({ error: "Schichtprofil nicht gefunden." }, { status: 404 });
  }

  const snapshot = mergePlanningRules(facility, defaultPlanningRulesConfig);

  // Build assignments list: existing (minus replaced) + proposed
  let assignments = allAssignments;
  if (parsed.data.replaceAssignmentId) {
    assignments = assignments.filter((a) => a.id !== parsed.data.replaceAssignmentId);
  }

  const profilesById = new Map(allProfiles.map((p) => [p.id, p]));
  const proposedDateKey = toIsoDateOnly(date);
  const proposedDayMs = date.getTime();
  const proposedInterval = shiftIntervalMs(date, profile.startTime, profile.endTime);
  const empQualTags = employee.qualificationTags;
  const empAllowedIds = employee.allowedShiftProfiles.map((p) => p.id);

  const errors: RuleMessage[] = [];
  const warnings: RuleMessage[] = [];

  // ──────────────────────────────────────────────
  // 1. Shift overlap: does this employee already have a shift that overlaps?
  // ──────────────────────────────────────────────
  if (snapshot.ruleStates.noOverlap?.enabled !== false) {
    for (const a of assignments) {
      if (a.employeeId !== parsed.data.employeeId) continue;
      const ap = profilesById.get(a.shiftProfileId);
      if (!ap) continue;
      const aInterval = shiftIntervalMs(a.date, ap.startTime, ap.endTime);
      if (proposedInterval.startMs < aInterval.endMs && aInterval.startMs < proposedInterval.endMs) {
        const empName = `${employee.firstName} ${employee.lastName}`;
        errors.push({
          ruleId: "noOverlap",
          code: "OVERLAP",
          message: `${empName} hat bereits eine überlappende Schicht (${ap.startTime}–${ap.endTime}).`,
          employeeIds: [parsed.data.employeeId],
        });
      }
    }
  }

  // ──────────────────────────────────────────────
  // 2. Minimum rest between shifts (e.g. 11h)
  // ──────────────────────────────────────────────
  if (snapshot.ruleStates.minRestBetweenShifts?.enabled !== false) {
    const minRestMs = snapshot.minRestHours * 60 * 60 * 1000;
    const empAssignments = assignments.filter((a) => a.employeeId === parsed.data.employeeId);
    for (const a of empAssignments) {
      const ap = profilesById.get(a.shiftProfileId);
      if (!ap) continue;
      const aInterval = shiftIntervalMs(a.date, ap.startTime, ap.endTime);
      // Check if rest gap is too small in either direction
      const gapAfter = proposedInterval.startMs - aInterval.endMs;
      const gapBefore = aInterval.startMs - proposedInterval.endMs;
      if ((gapAfter > 0 && gapAfter < minRestMs) || (gapBefore > 0 && gapBefore < minRestMs)) {
        const empName = `${employee.firstName} ${employee.lastName}`;
        const gapHours = Math.min(
          gapAfter > 0 ? gapAfter : Infinity,
          gapBefore > 0 ? gapBefore : Infinity,
        ) / (60 * 60 * 1000);
        errors.push({
          ruleId: "minRestBetweenShifts",
          code: "INSUFFICIENT_REST",
          message: `${empName}: Nur ${gapHours.toFixed(1)}h Ruhezeit (mind. ${snapshot.minRestHours}h) zur Schicht am ${toIsoDateOnly(a.date)}.`,
          employeeIds: [parsed.data.employeeId],
        });
      }
    }
  }

  // ──────────────────────────────────────────────
  // 3. Allowed shift profiles
  // ──────────────────────────────────────────────
  if (snapshot.ruleStates.allowedShiftProfiles?.enabled !== false) {
    if (empAllowedIds.length > 0 && !empAllowedIds.includes(parsed.data.shiftProfileId)) {
      const empName = `${employee.firstName} ${employee.lastName}`;
      errors.push({
        ruleId: "allowedShiftProfiles",
        code: "PROFILE_NOT_ALLOWED",
        message: `${empName} darf das Schichtprofil "${profile.name}" nicht arbeiten.`,
        employeeIds: [parsed.data.employeeId],
      });
    }
  }

  // ──────────────────────────────────────────────
  // 4. Max consecutive days — would this assignment extend a streak beyond limit?
  // ──────────────────────────────────────────────
  if (snapshot.ruleStates.maxConsecutiveDays?.enabled !== false) {
    const globalMax = (snapshot.ruleStates.maxConsecutiveDays?.params?.maxDays as number) ?? 7;
    const empMax = (employee as unknown as { maxConsecutiveDays?: number | null }).maxConsecutiveDays ?? globalMax;
    const empDays = new Set<string>();
    for (const a of assignments) {
      if (a.employeeId === parsed.data.employeeId) {
        empDays.add(utcDayKey(a.date));
      }
    }
    empDays.add(proposedDateKey);
    // Count streak including the proposed day
    const DAY_MS = 24 * 60 * 60 * 1000;
    let streak = 1;
    // Count backwards from proposed day
    let d = proposedDayMs - DAY_MS;
    while (empDays.has(new Date(d).toISOString().slice(0, 10))) {
      streak++;
      d -= DAY_MS;
    }
    // Count forwards from proposed day
    d = proposedDayMs + DAY_MS;
    while (empDays.has(new Date(d).toISOString().slice(0, 10))) {
      streak++;
      d += DAY_MS;
    }
    if (streak > empMax) {
      const empName = `${employee.firstName} ${employee.lastName}`;
      warnings.push({
        ruleId: "maxConsecutiveDays",
        code: "MAX_CONSECUTIVE_DAYS",
        message: `${empName}: ${streak} Tage am Stück (max. ${empMax}).`,
        employeeIds: [parsed.data.employeeId],
      });
    }
  }

  // ──────────────────────────────────────────────
  // 5. Max consecutive nights
  // ──────────────────────────────────────────────
  if (snapshot.ruleStates.maxConsecutiveNights?.enabled !== false && profile.shiftType === "NIGHT") {
    const maxNights = (snapshot.ruleStates.maxConsecutiveNights?.params?.maxCount as number) ?? 3;
    const nightDays = new Set<string>();
    for (const a of assignments) {
      if (a.employeeId !== parsed.data.employeeId) continue;
      const ap = profilesById.get(a.shiftProfileId);
      if (ap?.shiftType === "NIGHT") nightDays.add(utcDayKey(a.date));
    }
    nightDays.add(proposedDateKey);
    const DAY_MS = 24 * 60 * 60 * 1000;
    let streak = 1;
    let d = proposedDayMs - DAY_MS;
    while (nightDays.has(new Date(d).toISOString().slice(0, 10))) {
      streak++;
      d -= DAY_MS;
    }
    d = proposedDayMs + DAY_MS;
    while (nightDays.has(new Date(d).toISOString().slice(0, 10))) {
      streak++;
      d += DAY_MS;
    }
    if (streak > maxNights) {
      const empName = `${employee.firstName} ${employee.lastName}`;
      errors.push({
        ruleId: "maxConsecutiveNights",
        code: "MAX_CONSECUTIVE_NIGHTS",
        message: `${empName}: ${streak} Nachtschichten am Stück (max. ${maxNights}).`,
        employeeIds: [parsed.data.employeeId],
      });
    }
  }

  // ──────────────────────────────────────────────
  // 6. Mini-job monthly hours cap
  // ──────────────────────────────────────────────
  if (snapshot.ruleStates.miniJobMonthlyHours?.enabled !== false && employee.contractType === "MINI_JOB") {
    const limit = employee.miniJobMaxMonthlyHours
      ? Number(employee.miniJobMaxMonthlyHours)
      : snapshot.miniJobMaxMonthlyHours;
    const month = utcMonthKey(date);
    let total = 0;
    for (const a of assignments) {
      if (a.employeeId !== parsed.data.employeeId) continue;
      if (utcMonthKey(a.date) !== month) continue;
      const ap = profilesById.get(a.shiftProfileId);
      if (!ap) continue;
      total += assignmentPaidHours(a.date, ap.startTime, ap.endTime, ap.breakMinutes);
    }
    total += assignmentPaidHours(date, profile.startTime, profile.endTime, profile.breakMinutes);
    if (total > limit + 0.01) {
      const empName = `${employee.firstName} ${employee.lastName}`;
      errors.push({
        ruleId: "miniJobMonthlyHours",
        code: "MINI_JOB_CAP",
        message: `${empName}: Minijob-Stunden im Monat ${total.toFixed(1)}h überschreiten Limit ${limit}h.`,
        employeeIds: [parsed.data.employeeId],
      });
    }
  }

  // ──────────────────────────────────────────────
  // 7. Overtime excess (soft warning)
  // ──────────────────────────────────────────────
  if (snapshot.ruleStates.overtimeExcess?.enabled !== false) {
    const pct = employee.targetHoursPercent != null ? Number(employee.targetHoursPercent) : null;
    if (pct != null) {
      const y = date.getUTCFullYear();
      const mo = date.getUTCMonth();
      const daysInMonth = new Date(y, mo + 1, 0).getDate();
      let workingDays = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        const dow = new Date(y, mo, day).getDay();
        if (dow !== 0 && dow !== 6) workingDays++;
      }
      const soll = workingDays * 8 * (pct / 100);

      let hours = 0;
      const month = utcMonthKey(date);
      for (const a of assignments) {
        if (a.employeeId !== parsed.data.employeeId) continue;
        if (utcMonthKey(a.date) !== month) continue;
        const ap = profilesById.get(a.shiftProfileId);
        if (!ap) continue;
        hours += assignmentPaidHours(a.date, ap.startTime, ap.endTime, ap.breakMinutes);
      }
      hours += assignmentPaidHours(date, profile.startTime, profile.endTime, profile.breakMinutes);

      if (hours > soll + 8) {
        const empName = `${employee.firstName} ${employee.lastName}`;
        warnings.push({
          ruleId: "overtimeExcess",
          code: "OVERTIME_EXCESS",
          message: `${empName}: ${hours.toFixed(1)}h geplant (Soll: ${soll.toFixed(1)}h, max +8h Überstunden).`,
          employeeIds: [parsed.data.employeeId],
        });
      }
    }
  }

  // ──────────────────────────────────────────────
  // 8. Max staffing on this day/shift/station (soft warning) — only for this specific day
  // ──────────────────────────────────────────────
  if (snapshot.ruleStates.maxStaffing?.enabled !== false) {
    const isSH = empQualTags.includes("SH");
    if (!isSH) {
      // Pre-load qualificationTags for all employees assigned on this day to avoid N+1
      const dayAssignments = assignments.filter((a) => toIsoDateOnly(a.date) === proposedDateKey);
      const dayEmployeeIds = [...new Set(dayAssignments.map((a) => a.employeeId))];
      const dayEmployees = await prisma.employee.findMany({
        where: { id: { in: dayEmployeeIds } },
        select: { id: true, qualificationTags: true },
      });
      const empTagsById = new Map(dayEmployees.map((e) => [e.id, e.qualificationTags]));

      for (const req of staffingRows) {
        if (req.maxTotalCount == null) continue;
        if (req.shiftType !== profile.shiftType) continue;

        let count = 0;
        for (const a of dayAssignments) {
          const ap = profilesById.get(a.shiftProfileId);
          if (!ap || ap.shiftType !== req.shiftType) continue;
          const aEmpTags = empTagsById.get(a.employeeId) ?? [];
          if (aEmpTags.includes("SH")) continue;
          if (!req.isFacilityWide) {
            if (a.stationNumber != null && a.stationNumber !== req.stationNumber) continue;
          }
          count++;
        }
        // +1 for the proposed assignment
        count += 1;
        if (count > req.maxTotalCount) {
          const stLabel = req.isFacilityWide ? "gesamt" : `Station ${req.stationNumber}`;
          warnings.push({
            ruleId: "maxStaffing",
            code: "OVERSTAFFED",
            message: `Überbesetzung: ${count} Mitarbeiter für ${profile.shiftType} ${stLabel} (max. ${req.maxTotalCount}).`,
          });
        }
      }
    }
  }

  return NextResponse.json({ errors, warnings });
}
