-- Allow Assignment rows that are pure absence markers (K, U, ...) without
-- requiring a shift profile. Previously the planner could not save a K
-- marking on a day where the employee had no shift, because the column was
-- NOT NULL.
ALTER TABLE "Assignment" ALTER COLUMN "shiftProfileId" DROP NOT NULL;
