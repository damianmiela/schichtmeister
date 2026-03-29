-- Optional station assignment for employees (1, 2, or 3; NULL = any station)
ALTER TABLE "Employee" ADD COLUMN "assignedStationNumber" INTEGER;
