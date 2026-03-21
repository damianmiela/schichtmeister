import type { ContractType } from "@prisma/client";
import { ContractType as CT, TargetHoursPeriod } from "@prisma/client";

/** 40h/week × 52 weeks / 12 months — reference for 100% monthly Soll. */
export const REFERENCE_FULL_TIME_MONTHLY_HOURS =
  Math.round(((40 * 52) / 12) * 100) / 100;

export function monthlyTargetHoursFromPercent(percent: number): number {
  const v = (percent / 100) * REFERENCE_FULL_TIME_MONTHLY_HOURS;
  return Math.round(v * 100) / 100;
}

export type DenormalizedEmployeeContract = {
  contractType: ContractType;
  targetHours: number | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  miniJobMaxMonthlyHours: number | null;
  targetHoursPercent: number | null;
};

/**
 * Maps contract + Soll % (+ optional mini-job monthly cap for MINI_JOB) to stored columns.
 */
export function denormalizedContractFromInputs(
  contractType: ContractType,
  targetHoursPercent: number | null | undefined,
  miniJobMaxMonthlyHours: number | null | undefined,
): DenormalizedEmployeeContract {
  const miniOnlyForMiniJob =
    contractType === CT.MINI_JOB
      ? miniJobMaxMonthlyHours === undefined
        ? null
        : miniJobMaxMonthlyHours
      : null;

  const pct =
    targetHoursPercent === undefined ||
    targetHoursPercent === null ||
    targetHoursPercent === 0
      ? null
      : targetHoursPercent;

  if (contractType === CT.MINI_JOB) {
    if (pct == null) {
      return {
        contractType,
        targetHours: null,
        targetHoursPeriod: null,
        miniJobMaxMonthlyHours: miniOnlyForMiniJob,
        targetHoursPercent: null,
      };
    }
    return {
      contractType,
      targetHours: monthlyTargetHoursFromPercent(pct),
      targetHoursPeriod: TargetHoursPeriod.MONTHLY,
      miniJobMaxMonthlyHours: miniOnlyForMiniJob,
      targetHoursPercent: pct,
    };
  }

  if (pct == null) {
    return {
      contractType,
      targetHours: null,
      targetHoursPeriod: null,
      miniJobMaxMonthlyHours: null,
      targetHoursPercent: null,
    };
  }

  return {
    contractType,
    targetHours: monthlyTargetHoursFromPercent(pct),
    targetHoursPeriod: TargetHoursPeriod.MONTHLY,
    miniJobMaxMonthlyHours: null,
    targetHoursPercent: pct,
  };
}

export function defaultNewEmployeeContract(): DenormalizedEmployeeContract {
  return denormalizedContractFromInputs(CT.FULL_TIME, null, null);
}
