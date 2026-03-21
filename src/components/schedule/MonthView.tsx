"use client";

import ScheduleDataPlaceholder from "@/components/schedule/ScheduleDataPlaceholder";

interface MonthViewProps {
  year: number;
  month: number;
  selectedStation: string | null;
  onWeekClick: (weekNumber: number, startDate: Date) => void;
  onDayClick: (date: Date) => void;
}

export default function MonthView(props: MonthViewProps) {
  void props;
  return <ScheduleDataPlaceholder title="Besetzungsübersicht (Monat)" />;
}
