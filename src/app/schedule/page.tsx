"use client";

import { useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import MonthView from "@/components/schedule/MonthView";
import MonthTableView from "@/components/schedule/MonthTableView";
import WeekView from "@/components/schedule/WeekView";
import DayView from "@/components/schedule/DayView";
import StationFilter from "@/components/schedule/StationFilter";
import {
  Box,
  Button,
  IconButton,
  Typography,
  Chip,
  Breadcrumbs,
  Link,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PublishIcon from "@mui/icons-material/Publish";
import DownloadIcon from "@mui/icons-material/Download";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CalendarViewWeekIcon from "@mui/icons-material/CalendarViewWeek";
import TodayIcon from "@mui/icons-material/Today";
import TableChartIcon from "@mui/icons-material/TableChart";
import GridViewIcon from "@mui/icons-material/GridView";
import { getWeekNumber } from "@/lib/schedule-data";

type ViewType = "month" | "week" | "day";
type MonthViewMode = "table" | "overview"; // table = paper-like, overview = numeric Besetzungsübersicht

interface ViewState {
  type: ViewType;
  year: number;
  month: number;
  weekNumber?: number;
  weekStartDate?: Date;
  date?: Date;
}

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export default function SchedulePage() {
  const today = new Date();
  const [viewState, setViewState] = useState<ViewState>({
    type: "month",
    year: today.getFullYear(),
    month: today.getMonth(),
  });
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [monthViewMode, setMonthViewMode] = useState<MonthViewMode>("table"); // Default to table (paper-like)

  // Navigation handlers
  const handlePrevious = () => {
    if (viewState.type === "month") {
      const newMonth = viewState.month - 1;
      if (newMonth < 0) {
        setViewState({ ...viewState, year: viewState.year - 1, month: 11 });
      } else {
        setViewState({ ...viewState, month: newMonth });
      }
    } else if (viewState.type === "week" && viewState.weekStartDate) {
      const newStart = new Date(viewState.weekStartDate);
      newStart.setDate(newStart.getDate() - 7);
      setViewState({
        ...viewState,
        weekNumber: getWeekNumber(newStart),
        weekStartDate: newStart,
      });
    } else if (viewState.type === "day" && viewState.date) {
      const newDate = new Date(viewState.date);
      newDate.setDate(newDate.getDate() - 1);
      setViewState({ ...viewState, date: newDate });
    }
  };

  const handleNext = () => {
    if (viewState.type === "month") {
      const newMonth = viewState.month + 1;
      if (newMonth > 11) {
        setViewState({ ...viewState, year: viewState.year + 1, month: 0 });
      } else {
        setViewState({ ...viewState, month: newMonth });
      }
    } else if (viewState.type === "week" && viewState.weekStartDate) {
      const newStart = new Date(viewState.weekStartDate);
      newStart.setDate(newStart.getDate() + 7);
      setViewState({
        ...viewState,
        weekNumber: getWeekNumber(newStart),
        weekStartDate: newStart,
      });
    } else if (viewState.type === "day" && viewState.date) {
      const newDate = new Date(viewState.date);
      newDate.setDate(newDate.getDate() + 1);
      setViewState({ ...viewState, date: newDate });
    }
  };

  const handleWeekClick = (weekNumber: number, startDate: Date) => {
    setViewState({
      ...viewState,
      type: "week",
      weekNumber,
      weekStartDate: startDate,
    });
  };

  const handleDayClick = (date: Date) => {
    setViewState({
      ...viewState,
      type: "day",
      date,
    });
  };

  const handleBackToMonth = () => {
    setViewState({
      type: "month",
      year: viewState.year,
      month: viewState.month,
    });
  };

  const handleBackToWeek = () => {
    if (viewState.date) {
      // Get Monday of the current date's week
      const monday = new Date(viewState.date);
      const day = monday.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      monday.setDate(monday.getDate() + diff);

      setViewState({
        ...viewState,
        type: "week",
        weekNumber: getWeekNumber(monday),
        weekStartDate: monday,
      });
    }
  };

  // Get current view title
  const getViewTitle = () => {
    if (viewState.type === "month") {
      return `${MONTH_NAMES[viewState.month]} ${viewState.year}`;
    }
    if (viewState.type === "week" && viewState.weekStartDate) {
      const endDate = new Date(viewState.weekStartDate);
      endDate.setDate(endDate.getDate() + 6);
      return `KW ${viewState.weekNumber} • ${viewState.weekStartDate.getDate()}.${viewState.weekStartDate.getMonth() + 1}. - ${endDate.getDate()}.${endDate.getMonth() + 1}.${endDate.getFullYear()}`;
    }
    if (viewState.type === "day" && viewState.date) {
      return viewState.date.toLocaleDateString("de-DE", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    }
    return "";
  };

  return (
    <MainLayout title="Monatplan">
      {/* Breadcrumb navigation */}
      <Box sx={{ mb: 2 }}>
        <Breadcrumbs>
          <Link
            component="button"
            underline="hover"
            color={viewState.type === "month" ? "text.primary" : "inherit"}
            onClick={handleBackToMonth}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              cursor: "pointer",
            }}
          >
            <CalendarMonthIcon sx={{ fontSize: 18 }} />
            Monat
          </Link>
          {(viewState.type === "week" || viewState.type === "day") && (
            <Link
              component="button"
              underline="hover"
              color={viewState.type === "week" ? "text.primary" : "inherit"}
              onClick={handleBackToWeek}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                cursor: "pointer",
              }}
            >
              <CalendarViewWeekIcon sx={{ fontSize: 18 }} />
              KW {viewState.weekNumber || getWeekNumber(viewState.date || new Date())}
            </Link>
          )}
          {viewState.type === "day" && viewState.date && (
            <Typography
              color="text.primary"
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <TodayIcon sx={{ fontSize: 18 }} />
              {viewState.date.getDate()}.{viewState.date.getMonth() + 1}.
            </Typography>
          )}
        </Breadcrumbs>
      </Box>

      {/* Header Actions */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={handlePrevious}>
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h6" sx={{ minWidth: 280, textAlign: "center" }}>
            {getViewTitle()}
          </Typography>
          <IconButton onClick={handleNext}>
            <ChevronRightIcon />
          </IconButton>
          <Chip label="ENTWURF" color="warning" size="small" />
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          {/* View mode toggle - only show in month view */}
          {viewState.type === "month" && (
            <>
              <ToggleButtonGroup
                value={monthViewMode}
                exclusive
                onChange={(_, value) => value && setMonthViewMode(value)}
                size="small"
                sx={{
                  "& .MuiToggleButton-root": {
                    px: 1.5,
                    py: 0.5,
                    fontSize: "0.75rem",
                  },
                }}
              >
                <ToggleButton value="table">
                  <TableChartIcon sx={{ fontSize: 18, mr: 0.5 }} />
                  Dienstplan
                </ToggleButton>
                <ToggleButton value="overview">
                  <GridViewIcon sx={{ fontSize: 18, mr: 0.5 }} />
                  Besetzungsübersicht
                </ToggleButton>
              </ToggleButtonGroup>
              <Box sx={{ width: 1, height: 24, bgcolor: "divider", mx: 1 }} />
            </>
          )}
          <StationFilter selected={selectedStation} onChange={setSelectedStation} />
          <Box sx={{ width: 1, height: 24, bgcolor: "divider", mx: 1 }} />
          <Button variant="outlined" startIcon={<DownloadIcon />}>
            Export
          </Button>
          <Button variant="contained" startIcon={<PublishIcon />}>
            Veröffentlichen
          </Button>
        </Box>
      </Box>

      {/* Views */}
      {viewState.type === "month" && monthViewMode === "table" && (
        <MonthTableView
          year={viewState.year}
          month={viewState.month}
          selectedStation={selectedStation}
          onDayClick={handleDayClick}
        />
      )}

      {viewState.type === "month" && monthViewMode === "overview" && (
        <MonthView
          year={viewState.year}
          month={viewState.month}
          selectedStation={selectedStation}
          onWeekClick={handleWeekClick}
          onDayClick={handleDayClick}
        />
      )}

      {viewState.type === "week" && viewState.weekStartDate && (
        <WeekView
          weekNumber={viewState.weekNumber!}
          startDate={viewState.weekStartDate}
          selectedStation={selectedStation}
          onDayClick={handleDayClick}
        />
      )}

      {viewState.type === "day" && viewState.date && (
        <DayView date={viewState.date} selectedStation={selectedStation} />
      )}
    </MainLayout>
  );
}
