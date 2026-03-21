"use client";

import ScheduleDataPlaceholder from "@/components/schedule/ScheduleDataPlaceholder";

interface MonthTableViewProps {
  year: number;
  month: number;
  selectedStation: string | null;
  onDayClick: (date: Date) => void;
}

export default function MonthTableView(props: MonthTableViewProps) {
  void props;
  return <ScheduleDataPlaceholder title="Monatsplan (Tabelle)" />;
}
