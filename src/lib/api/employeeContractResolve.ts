import type { ContractType } from "@prisma/client";
import { ContractType as CT } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  denormalizedContractFromInputs,
  type DenormalizedEmployeeContract,
} from "@/lib/employeeContractDenorm";

export async function resolveContractForCreate(
  facilityId: string,
  input: {
    workProfileId?: string | null;
    contractType?: ContractType;
    targetHoursPercent?: number | null;
    miniJobMaxMonthlyHours?: number | null;
  },
): Promise<
  | { ok: true; block: DenormalizedEmployeeContract; workProfileConnectId: string | null }
  | { ok: false; error: string; status: number }
> {
  const wpid = input.workProfileId ?? null;
  if (wpid) {
    const wp = await prisma.employeeWorkProfile.findFirst({
      where: { id: wpid, facilityId },
    });
    if (!wp) {
      return { ok: false, error: "Arbeitszeit-Profil nicht gefunden.", status: 400 };
    }
    const block = denormalizedContractFromInputs(
      wp.contractType,
      Number(wp.targetHoursPercent),
      wp.miniJobMaxMonthlyHours != null ? Number(wp.miniJobMaxMonthlyHours) : null,
    );
    return { ok: true, block, workProfileConnectId: wp.id };
  }

  const contractType = (input.contractType ?? CT.FULL_TIME) as ContractType;
  const block = denormalizedContractFromInputs(
    contractType,
    input.targetHoursPercent ?? null,
    input.miniJobMaxMonthlyHours === undefined ? null : input.miniJobMaxMonthlyHours,
  );
  return { ok: true, block, workProfileConnectId: null };
}

type ExistingEmp = {
  workProfileId: string | null;
  contractType: ContractType;
  targetHoursPercent: { toString(): string } | null;
  miniJobMaxMonthlyHours: { toString(): string } | null;
};

export async function resolveContractForPatch(
  facilityId: string,
  existing: ExistingEmp,
  data: {
    workProfileId?: string | null;
    contractType?: ContractType;
    targetHoursPercent?: number | null;
    miniJobMaxMonthlyHours?: number | null;
  },
): Promise<
  | {
      ok: true;
      block: DenormalizedEmployeeContract | null;
      workProfile: { connect: { id: string } } | { disconnect: true } | null;
    }
  | { ok: false; error: string; status: number }
> {
  const mergedMini = (): number | null => {
    if (data.miniJobMaxMonthlyHours !== undefined) {
      return data.miniJobMaxMonthlyHours;
    }
    return existing.miniJobMaxMonthlyHours != null
      ? Number(existing.miniJobMaxMonthlyHours)
      : null;
  };

  const mergedPercent = (): number | null => {
    if (data.targetHoursPercent !== undefined) {
      return data.targetHoursPercent;
    }
    return existing.targetHoursPercent != null
      ? Number(existing.targetHoursPercent)
      : null;
  };

  if (data.workProfileId !== undefined && data.workProfileId) {
    const wp = await prisma.employeeWorkProfile.findFirst({
      where: { id: data.workProfileId, facilityId },
    });
    if (!wp) {
      return { ok: false, error: "Arbeitszeit-Profil nicht gefunden.", status: 400 };
    }
    const block = denormalizedContractFromInputs(
      wp.contractType,
      Number(wp.targetHoursPercent),
      wp.miniJobMaxMonthlyHours != null ? Number(wp.miniJobMaxMonthlyHours) : null,
    );
    return { ok: true, block, workProfile: { connect: { id: wp.id } } };
  }

  if (data.workProfileId === null) {
    const block = denormalizedContractFromInputs(
      data.contractType ?? existing.contractType,
      mergedPercent(),
      mergedMini(),
    );
    return { ok: true, block, workProfile: { disconnect: true } };
  }

  if (
    existing.workProfileId &&
    (data.contractType !== undefined ||
      data.targetHoursPercent !== undefined ||
      data.miniJobMaxMonthlyHours !== undefined)
  ) {
    const block = denormalizedContractFromInputs(
      data.contractType ?? existing.contractType,
      mergedPercent(),
      mergedMini(),
    );
    return { ok: true, block, workProfile: { disconnect: true } };
  }

  if (
    !existing.workProfileId &&
    (data.contractType !== undefined ||
      data.targetHoursPercent !== undefined ||
      data.miniJobMaxMonthlyHours !== undefined)
  ) {
    const block = denormalizedContractFromInputs(
      data.contractType ?? existing.contractType,
      mergedPercent(),
      mergedMini(),
    );
    return { ok: true, block, workProfile: null };
  }

  return { ok: true, block: null, workProfile: null };
}
