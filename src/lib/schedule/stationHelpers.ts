import { ShiftType } from "@prisma/client";

const SHIFT_TYPE_PREFIX: Record<ShiftType, string> = {
  [ShiftType.EARLY]: "F",
  [ShiftType.LATE]: "S",
  [ShiftType.NIGHT]: "N",
};

export function autoProfileName(shiftType: ShiftType, stationNumber: number): string {
  return `${SHIFT_TYPE_PREFIX[shiftType]}${stationNumber}`;
}
