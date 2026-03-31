/**
 * German public holidays for Rheinland-Pfalz.
 *
 * Holidays on weekdays reduce the monthly Soll-Stunden per German labour law
 * (Entgeltfortzahlungsgesetz / TVöD).
 */

export interface Holiday {
  date: Date;
  name: string;
  isStateSpecific: boolean;
}

/**
 * Easter Sunday via the Anonymous Gregorian algorithm
 * (Meeus / Jones / Butcher).
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Mar, 4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** All Rheinland-Pfalz public holidays for a given year. */
export function getHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const fixed = (m: number, d: number, name: string, state = false): Holiday => ({
    date: new Date(Date.UTC(year, m - 1, d)),
    name,
    isStateSpecific: state,
  });

  return [
    fixed(1, 1, "Neujahr"),
    { date: addDays(easter, -2), name: "Karfreitag", isStateSpecific: false },
    { date: addDays(easter, 1), name: "Ostermontag", isStateSpecific: false },
    fixed(5, 1, "Tag der Arbeit"),
    { date: addDays(easter, 39), name: "Christi Himmelfahrt", isStateSpecific: false },
    { date: addDays(easter, 50), name: "Pfingstmontag", isStateSpecific: false },
    { date: addDays(easter, 60), name: "Fronleichnam", isStateSpecific: true },
    fixed(10, 3, "Tag der Deutschen Einheit"),
    fixed(11, 1, "Allerheiligen", true),
    fixed(12, 25, "1. Weihnachtstag"),
    fixed(12, 26, "2. Weihnachtstag"),
  ];
}

/** Holidays that fall on a weekday (Mon-Fri) within [start, end]. */
export function getWeekdayHolidays(start: Date, end: Date): Holiday[] {
  const startTs = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endTs = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

  const years = new Set<number>();
  years.add(start.getUTCFullYear());
  years.add(end.getUTCFullYear());

  const result: Holiday[] = [];
  for (const y of years) {
    for (const h of getHolidays(y)) {
      const ts = h.date.getTime();
      if (ts < startTs || ts > endTs) continue;
      const dow = h.date.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      result.push(h);
    }
  }
  return result;
}

/**
 * Count working days in a month, subtracting weekends AND Rheinland-Pfalz
 * holidays that fall on weekdays.
 */
export function monthlyWorkingDaysWithHolidays(year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let wd = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) wd++;
  }

  const holidays = getWeekdayHolidays(
    new Date(Date.UTC(year, month, 1)),
    new Date(Date.UTC(year, month + 1, 0)),
  );
  return wd - holidays.length;
}

/** ISO date string set for holidays in a date range (for UI indicators). */
export function holidayDateMap(start: Date, end: Date): Map<string, string> {
  const map = new Map<string, string>();
  const years = new Set<number>();
  years.add(start.getUTCFullYear());
  years.add(end.getUTCFullYear());

  const startTs = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endTs = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

  for (const y of years) {
    for (const h of getHolidays(y)) {
      const ts = h.date.getTime();
      if (ts < startTs || ts > endTs) continue;
      const iso = h.date.toISOString().slice(0, 10);
      map.set(iso, h.name);
    }
  }
  return map;
}
