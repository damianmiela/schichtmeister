import type { ContractType } from "@prisma/client";
import { ContractType as CT, TargetHoursPeriod } from "@prisma/client";
import type { Prisma } from "@prisma/client";

/** Referenz-Vollzeit pro Woche für Umrechnung targetHoursPercent → wöchentliche Soll-Stunden. */
export const REFERENCE_FULL_TIME_WEEKLY_HOURS = 40;

export function weeklyTargetHoursFromPercent(percent: number): number {
  const v = (percent / 100) * REFERENCE_FULL_TIME_WEEKLY_HOURS;
  return Math.round(v * 100) / 100;
}

type ProfileLike = {
  contractType: ContractType;
  targetHoursPercent: Prisma.Decimal | number | { toString(): string };
  miniJobMaxMonthlyHours: Prisma.Decimal | null | { toString(): string } | number | null;
};

export type DenormalizedEmployeeContract = {
  contractType: ContractType;
  targetHours: number | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  miniJobMaxMonthlyHours: number | null;
};

/**
 * Übernimmt Vertragsart und abgeleitete Soll-Stunden aus dem Schichtprofil in die Mitarbeiter-Zeile
 * (wird von Generator & Planungsregeln weiter wie bisher gelesen).
 */
export function denormalizedEmployeeFieldsFromShiftProfile(
  profile: ProfileLike,
): DenormalizedEmployeeContract {
  const pct = Number(profile.targetHoursPercent);
  if (profile.contractType === CT.MINI_JOB) {
    return {
      contractType: profile.contractType,
      targetHours: null,
      targetHoursPeriod: null,
      miniJobMaxMonthlyHours:
        profile.miniJobMaxMonthlyHours != null
          ? Number(profile.miniJobMaxMonthlyHours)
          : null,
    };
  }
  return {
    contractType: profile.contractType,
    targetHours: weeklyTargetHoursFromPercent(pct),
    targetHoursPeriod: TargetHoursPeriod.WEEKLY,
    miniJobMaxMonthlyHours: null,
  };
}

export function defaultEmployeeFieldsWithoutProfile(): DenormalizedEmployeeContract {
  return {
    contractType: CT.FULL_TIME,
    targetHours: null,
    targetHoursPeriod: null,
    miniJobMaxMonthlyHours: null,
  };
}
