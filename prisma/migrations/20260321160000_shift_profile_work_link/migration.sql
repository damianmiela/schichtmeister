-- Schichtprofil: Soll als %-Anteil (Referenz: 40h/Woche) + Vertragsart für Mitarbeiter-Zuordnung
ALTER TABLE "ShiftProfile" ADD COLUMN "targetHoursPercent" DECIMAL(6,2) NOT NULL DEFAULT 100;
ALTER TABLE "ShiftProfile" ADD COLUMN "contractType" "ContractType" NOT NULL DEFAULT 'FULL_TIME';
ALTER TABLE "ShiftProfile" ADD COLUMN "miniJobMaxMonthlyHours" DECIMAL(8,2);

-- Mitarbeiter: optionales Schichtprofil (SetNull bei Profil-Löschung)
ALTER TABLE "Employee" ADD COLUMN "shiftProfileId" TEXT;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_shiftProfileId_fkey" FOREIGN KEY ("shiftProfileId") REFERENCES "ShiftProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Employee_shiftProfileId_idx" ON "Employee"("shiftProfileId");
