import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const assignmentCreateBodySchema = z.object({
  scheduleId: z.string().min(1),
  date: isoDate,
  shiftProfileId: z.string().min(1),
  employeeId: z.string().min(1),
  /** Skip rule validation and force-create the assignment. */
  force: z.boolean().optional(),
  /** Override station assignment (ignores employee station preference). */
  stationNumber: z.number().int().min(1).max(9).optional(),
});

export const assignmentPatchBodySchema = z
  .object({
    date: isoDate.optional(),
    shiftProfileId: z.string().min(1).optional(),
    employeeId: z.string().min(1).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "Mindestens ein Feld zum Aktualisieren angeben",
  });

export const assignmentValidateBodySchema = z.object({
  scheduleId: z.string().min(1),
  assignments: z.array(
    z.object({
      id: z.string().min(1),
      date: isoDate,
      shiftProfileId: z.string().min(1),
      employeeId: z.string().min(1),
    }),
  ),
});
