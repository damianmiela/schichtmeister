import { z } from "zod";

export const contractTypeZ = z.enum(["FULL_TIME", "PART_TIME", "MINI_JOB"]);
export const targetHoursPeriodZ = z.enum(["WEEKLY", "MONTHLY"]);
export const shiftTypeZ = z.enum(["EARLY", "LATE", "NIGHT"]);

export const employeeCreateSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  /** Optional: Profil bestimmt Vertrag/Soll (Prozent → Wochenstunden); ohne Profil Standard Vollzeit ohne Soll. */
  shiftProfileId: z.string().cuid().optional().nullable(),
  contractType: contractTypeZ.optional(),
  targetHours: z.number().positive().optional().nullable(),
  targetHoursPeriod: targetHoursPeriodZ.optional().nullable(),
  miniJobMaxMonthlyHours: z.number().positive().optional().nullable(),
  qualificationTags: z.array(z.string()).optional(),
  preferredShiftTypes: z.array(shiftTypeZ).optional(),
});

export const employeePatchSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    shiftProfileId: z.string().cuid().optional().nullable(),
    contractType: contractTypeZ.optional(),
    targetHours: z.number().positive().optional().nullable(),
    targetHoursPeriod: targetHoursPeriodZ.optional().nullable(),
    miniJobMaxMonthlyHours: z.number().positive().optional().nullable(),
    qualificationTags: z.array(z.string()).optional(),
    preferredShiftTypes: z.array(shiftTypeZ).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "Mindestens ein Feld zum Aktualisieren angeben",
  });
