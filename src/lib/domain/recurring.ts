export type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RecurringEndMode = "never" | "after_date" | "after_count";
export type RecurringDuzpMode = "issue_date" | "last_day_of_month";

export interface RecurringScheduleLike {
  frequency: string;
  intervalCount: number;
  startDate: string;
  nextRunDate: string;
  issueLastDayOfMonth: boolean;
  endMode: string;
  endDate: string | null;
  maxOccurrences: number | null;
  issuedCount: number;
  active: boolean;
}

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return {
    year: Number.isFinite(y) && y >= 2000 ? y : 2026,
    month: Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1,
    day: Number.isFinite(d) && d >= 1 && d <= 31 ? d : 1,
  };
}

function formatIsoDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysInMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

export function snapToLastDayOfMonth(iso: string): string {
  const { year, month } = parseIsoDate(iso);
  return formatIsoDate(year, month, daysInMonth(year, month));
}

export function normalizeStartDate(startDate: string, issueLastDayOfMonth: boolean): string {
  return issueLastDayOfMonth ? snapToLastDayOfMonth(startDate) : startDate;
}

export function advanceRecurringDate(
  iso: string,
  frequency: string,
  intervalCount: number,
  issueLastDayOfMonth = false,
): string {
  const step = Math.max(1, Math.floor(intervalCount) || 1);
  const { year, month, day } = parseIsoDate(iso);

  if (frequency === "daily") {
    const dt = new Date(Date.UTC(year, month - 1, day + step));
    const next = dt.toISOString().slice(0, 10);
    return issueLastDayOfMonth ? snapToLastDayOfMonth(next) : next;
  }

  if (frequency === "weekly") {
    const dt = new Date(Date.UTC(year, month - 1, day + 7 * step));
    const next = dt.toISOString().slice(0, 10);
    return issueLastDayOfMonth ? snapToLastDayOfMonth(next) : next;
  }

  if (frequency === "quarterly") {
    const totalMonths = (year * 12 + (month - 1)) + 3 * step;
    const ny = Math.floor(totalMonths / 12);
    const nm = (totalMonths % 12) + 1;
    const maxDay = daysInMonth(ny, nm);
    const nd = issueLastDayOfMonth ? maxDay : Math.min(day, maxDay);
    return formatIsoDate(ny, nm, nd);
  }

  if (frequency === "yearly") {
    const ny = year + step;
    const maxDay = daysInMonth(ny, month);
    const nd = issueLastDayOfMonth ? maxDay : Math.min(day, maxDay);
    return formatIsoDate(ny, month, nd);
  }

  // monthly (default)
  const totalMonths = (year * 12 + (month - 1)) + step;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1;
  const maxDay = daysInMonth(ny, nm);
  const nd = issueLastDayOfMonth ? maxDay : Math.min(day, maxDay);
  return formatIsoDate(ny, nm, nd);
}

export function computeRecurringDuzp(issueDate: string, duzpMode: string): string {
  if (duzpMode === "last_day_of_month") {
    return snapToLastDayOfMonth(issueDate);
  }
  return issueDate;
}

export function isScheduleFinished(
  schedule: Pick<
    RecurringScheduleLike,
    "endMode" | "endDate" | "maxOccurrences" | "issuedCount" | "nextRunDate"
  >,
): boolean {
  if (
    schedule.endMode === "after_count" &&
    schedule.maxOccurrences != null &&
    schedule.maxOccurrences > 0 &&
    schedule.issuedCount >= schedule.maxOccurrences
  ) {
    return true;
  }
  if (
    schedule.endMode === "after_date" &&
    schedule.endDate &&
    schedule.nextRunDate > schedule.endDate
  ) {
    return true;
  }
  return false;
}

export function computeFutureRunDates(
  schedule: Pick<
    RecurringScheduleLike,
    | "frequency"
    | "intervalCount"
    | "startDate"
    | "nextRunDate"
    | "issueLastDayOfMonth"
    | "endMode"
    | "endDate"
    | "maxOccurrences"
    | "issuedCount"
  >,
  maxPreview = 8,
): string[] {
  const result: string[] = [];
  let cursor = normalizeStartDate(
    schedule.nextRunDate || schedule.startDate,
    schedule.issueLastDayOfMonth,
  );
  let count = schedule.issuedCount || 0;

  for (let i = 0; i < maxPreview; i++) {
    if (
      schedule.endMode === "after_count" &&
      schedule.maxOccurrences != null &&
      schedule.maxOccurrences > 0 &&
      count >= schedule.maxOccurrences
    ) {
      break;
    }
    if (schedule.endMode === "after_date" && schedule.endDate && cursor > schedule.endDate) {
      break;
    }
    result.push(cursor);
    count += 1;
    cursor = advanceRecurringDate(
      cursor,
      schedule.frequency,
      schedule.intervalCount,
      schedule.issueLastDayOfMonth,
    );
  }
  return result;
}

/**
 * Expands iDoklad-compatible placeholders in recurring invoice texts:
 *   {document_number}
 *   {day}, {day+N}, {day-N}
 *   {month}, {month+N}, {month-N}
 *   {year}, {year+N}, {year-N}
 *   {quarter}, {quarter+N}, {quarter-N}
 *   {month/year}, {month/year+N}, {month/year-N}
 */
export function expandRecurringPlaceholders(
  text: string,
  issueDateIso: string,
  documentNumber = "",
): string {
  if (!text || !text.includes("{")) return text;
  const { year, month, day } = parseIsoDate(issueDateIso);

  return text.replace(
    /\{(document_number|month\/year|day|month|year|quarter)([+-]\d+)?\}/gi,
    (_match, rawToken: string, rawOffset?: string) => {
      const token = rawToken.toLowerCase();
      const offset = rawOffset ? Number(rawOffset) : 0;

      if (token === "document_number") {
        return documentNumber;
      }

      if (token === "day") {
        const dt = new Date(Date.UTC(year, month - 1, day + offset));
        return String(dt.getUTCDate());
      }

      if (token === "month") {
        const totalMonths = year * 12 + (month - 1) + offset;
        const m = ((totalMonths % 12) + 12) % 12 + 1;
        return String(m);
      }

      if (token === "year") {
        return String(year + offset);
      }

      if (token === "quarter") {
        const currentQ = Math.floor((month - 1) / 3); // 0..3
        const totalQ = year * 4 + currentQ + offset;
        const q = ((totalQ % 4) + 4) % 4 + 1;
        return String(q);
      }

      if (token === "month/year") {
        const totalMonths = year * 12 + (month - 1) + offset;
        const ny = Math.floor(totalMonths / 12);
        const nm = ((totalMonths % 12) + 12) % 12 + 1;
        return `${nm}/${ny}`;
      }

      return _match;
    },
  );
}

export function formatRecurringIntervalCz(frequency: string, intervalCount: number): string {
  const n = Math.max(1, Math.floor(intervalCount) || 1);
  if (frequency === "daily") {
    if (n === 1) return "Denně";
    if (n >= 2 && n <= 4) return `Každé ${n} dny`;
    return `Každých ${n} dní`;
  }
  if (frequency === "weekly") {
    if (n === 1) return "Týdně";
    if (n >= 2 && n <= 4) return `Každé ${n} týdny`;
    return `Každých ${n} týdnů`;
  }
  if (frequency === "quarterly") {
    return n === 1 ? "Čtvrtletně" : `Každých ${n * 3} měsíců`;
  }
  if (frequency === "yearly") {
    if (n === 1) return "Ročně";
    if (n >= 2 && n <= 4) return `Každé ${n} roky`;
    return `Každých ${n} let`;
  }
  if (n === 1) return "Měsíčně";
  if (n >= 2 && n <= 4) return `Každé ${n} měsíce`;
  return `Každých ${n} měsíců`;
}

export const RECURRING_PLACEHOLDERS = [
  { token: "{month/year}", label: "Měsíc/rok (např. 11/2026)" },
  { token: "{month/year-1}", label: "Minulý měsíc/rok" },
  { token: "{month}", label: "Číslo měsíce" },
  { token: "{month-1}", label: "Minulý měsíc" },
  { token: "{year}", label: "Rok" },
  { token: "{quarter}", label: "Čtvrtletí" },
  { token: "{day}", label: "Den vystavení" },
  { token: "{document_number}", label: "Číslo dokladu" },
] as const;
