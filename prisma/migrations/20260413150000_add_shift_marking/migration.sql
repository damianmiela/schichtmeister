-- CreateTable
CREATE TABLE "ShiftMarking" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#757575',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftMarking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftMarking_facilityId_code_key" ON "ShiftMarking"("facilityId", "code");

-- CreateIndex
CREATE INDEX "ShiftMarking_facilityId_sortOrder_idx" ON "ShiftMarking"("facilityId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ShiftMarking" ADD CONSTRAINT "ShiftMarking_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
