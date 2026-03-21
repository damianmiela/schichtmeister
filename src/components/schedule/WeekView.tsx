"use client";

import ScheduleDataPlaceholder from "@/components/schedule/ScheduleDataPlaceholder";

interface WeekViewProps {
  weekNumber: number;
  startDate: Date;
  selectedStation: string | null;
  onDayClick: (date: Date) => void;
}

export default function WeekView(props: WeekViewProps) {
  void props;
  return <ScheduleDataPlaceholder title="Wochenansicht" />;
}
