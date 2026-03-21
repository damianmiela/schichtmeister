"use client";

import ScheduleDataPlaceholder from "@/components/schedule/ScheduleDataPlaceholder";

interface DayViewProps {
  date: Date;
  selectedStation: string | null;
}

export default function DayView(props: DayViewProps) {
  void props;
  return <ScheduleDataPlaceholder title="Tagesansicht" />;
}
