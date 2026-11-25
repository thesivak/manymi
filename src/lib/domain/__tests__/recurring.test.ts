import { describe, expect, it } from "vitest";
import {
  advanceRecurringDate,
  computeFutureRunDates,
  computeRecurringDuzp,
  expandRecurringPlaceholders,
  formatRecurringIntervalCz,
} from "../recurring";

describe("pravidelné faktury — plánovač a zástupné znaky (parita s iDokladem)", () => {
  it("dosazuje všechny zástupné znaky včetně posunů +N / -N", () => {
    const template =
      "Služby za {month/year-1} (měsíc {month-1}/{year}, kvartál Q{quarter}, vystaveno {day}.{month}.{year}, č. {document_number})";
    const result = expandRecurringPlaceholders(template, "2026-01-15", "2026-0001");
    expect(result).toBe(
      "Služby za 12/2025 (měsíc 12/2026, kvartál Q1, vystaveno 15.1.2026, č. 2026-0001)",
    );

    expect(expandRecurringPlaceholders("Q{quarter-1} {year-1}", "2026-02-01")).toBe("Q4 2025");
    expect(expandRecurringPlaceholders("Den {day+2}", "2026-11-30")).toBe("Den 2");
  });

  it("respektuje volbu Vystavovat poslední den v měsíci včetně února", () => {
    const dates = computeFutureRunDates(
      {
        frequency: "monthly",
        intervalCount: 1,
        startDate: "2026-01-15",
        nextRunDate: "2026-01-15",
        issueLastDayOfMonth: true,
        endMode: "after_count",
        endDate: null,
        maxOccurrences: 4,
        issuedCount: 0,
      },
      6,
    );
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("respektuje ukončení po datu a vlastní intervaly (denně, týdně, ročně)", () => {
    expect(advanceRecurringDate("2026-11-01", "daily", 10, false)).toBe("2026-11-11");
    expect(advanceRecurringDate("2026-11-01", "weekly", 2, false)).toBe("2026-11-15");
    expect(advanceRecurringDate("2024-02-29", "yearly", 1, false)).toBe("2025-02-28");

    const dates = computeFutureRunDates(
      {
        frequency: "monthly",
        intervalCount: 2,
        startDate: "2026-01-10",
        nextRunDate: "2026-01-10",
        issueLastDayOfMonth: false,
        endMode: "after_date",
        endDate: "2026-05-15",
        maxOccurrences: null,
        issuedCount: 0,
      },
      10,
    );
    expect(dates).toEqual(["2026-01-10", "2026-03-10", "2026-05-10"]);
  });

  it("správně počítá DUZP a české popisky intervalů", () => {
    expect(computeRecurringDuzp("2026-04-05", "issue_date")).toBe("2026-04-05");
    expect(computeRecurringDuzp("2026-04-05", "last_day_of_month")).toBe("2026-04-30");
    expect(formatRecurringIntervalCz("monthly", 1)).toBe("Měsíčně");
    expect(formatRecurringIntervalCz("monthly", 3)).toBe("Každé 3 měsíce");
    expect(formatRecurringIntervalCz("weekly", 2)).toBe("Každé 2 týdny");
    expect(formatRecurringIntervalCz("daily", 5)).toBe("Každých 5 dní");
  });
});
