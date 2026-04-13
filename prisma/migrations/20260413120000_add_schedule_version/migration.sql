-- CreateTable
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "assignmentsJson" TEXT NOT NULL,
    "assignmentCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "scoreReport" TEXT,
    "generationLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleVersion_scheduleId_createdAt_idx" ON "ScheduleVersion"("scheduleId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleVersion_scheduleId_contentHash_idx" ON "ScheduleVersion"("scheduleId", "contentHash");

-- AddForeignKey
ALTER TABLE "ScheduleVersion" ADD CONSTRAINT "ScheduleVersion_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
