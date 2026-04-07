-- Drop EMPLOYEE from UserRole: move data to DEMO, then replace the enum type.
UPDATE "User" SET role = 'DEMO' WHERE role::text = 'EMPLOYEE';

CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'PLANNER', 'DEMO');

ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");

DROP TYPE "UserRole";

ALTER TYPE "UserRole_new" RENAME TO "UserRole";
