import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  addMonths,
  daysBetween,
  formatAmount,
  formatBytes,
  formatDayHeading,
  formatMoney,
  formatRelativeTime,
  monthOf,
  todayIso,
} from "~/lib/format";

/** Normalises the various Unicode spaces Intl uses as group separators, so assertions can be
 *  written with ordinary spaces without becoming brittle across ICU versions. */
const norm = (s: string) => s.replace(/[\u00a0\u2009\u202f]/g, " ");

describe("formatMoney", () => {
  it("uses each locale's own conventions rather than a hardcoded format", () => {
    // en groups with commas and puts the symbol first; uk/ru group with spaces and put it last.
    expect(norm(formatMoney(124_000, "UAH", "en"))).toBe("₴1,240");
    expect(norm(formatMoney(124_000, "UAH", "uk"))).toContain("1 240");
    expect(norm(formatMoney(124_000, "UAH", "ru"))).toContain("1 240");
  });

  it("hides cents by default and shows them on request", () => {
    expect(norm(formatMoney(124_000, "UAH", "en"))).toBe("₴1,240");
    expect(norm(formatMoney(124_050, "UAH", "en", { cents: true }))).toBe("₴1,240.50");
  });

  it("rounds to nearest when hiding cents, so a column of amounts still adds up", () => {
    // Truncating would make every displayed figure understate, and a mentally-added column
    // would drift further from the real total with each row.
    expect(norm(formatMoney(124_050, "UAH", "en"))).toBe("₴1,241");
    expect(norm(formatMoney(124_049, "UAH", "en"))).toBe("₴1,240");
  });

  it("uses narrow symbols so no currency falls back to its ISO code", () => {
    // uk would otherwise render EUR as "1 240 EUR", and en would render UAH as "UAH 1,240".
    expect(formatMoney(124_000, "EUR", "uk")).toContain("€");
    expect(formatMoney(124_000, "USD", "uk")).toContain("$");
    expect(formatMoney(124_000, "UAH", "en")).toContain("₴");
  });

  it("renders a real minus sign, not a hyphen", () => {
    const formatted = formatMoney(-124_000, "UAH", "en");
    expect(formatted.startsWith("−")).toBe(true);
    expect(formatted.includes("-")).toBe(false);
  });

  it("shows an explicit plus only when asked", () => {
    expect(formatMoney(500, "UAH", "en", { signed: true }).startsWith("+")).toBe(true);
    expect(formatMoney(500, "UAH", "en").startsWith("+")).toBe(false);
  });

  it("handles all three currencies", () => {
    expect(formatMoney(10_000, "EUR", "en", { cents: true })).toContain("100.00");
    expect(formatMoney(10_000, "USD", "en", { cents: true })).toContain("100.00");
    expect(norm(formatMoney(10_000, "UAH", "en", { cents: true }))).toContain("100.00");
  });
});

describe("formatAmount", () => {
  it("omits the currency symbol for table cells", () => {
    const formatted = norm(formatAmount(51_281_900, "UAH", "en"));
    expect(formatted).toBe("512,819");
    expect(formatted).not.toContain("₴");
  });
});

describe("date helpers", () => {
  it("derives today's date in the local timezone, not UTC", () => {
    // A purchase at 23:30 local belongs to today, not tomorrow. Using UTC would misfile
    // late-evening spending, which in Kyiv is a two- or three-hour window every day.
    const lateEvening = new Date(2026, 7, 5, 23, 30);
    expect(todayIso(lateEvening)).toBe("2026-08-05");
  });

  it("adds days across a month boundary", () => {
    expect(addDaysIso("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("adds days across a leap day", () => {
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("adds months across a year boundary", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-08", 12)).toBe("2027-08");
  });

  it("extracts the month", () => {
    expect(monthOf("2026-08-05")).toBe("2026-08");
  });

  it("counts days between dates, including across DST changes", () => {
    expect(daysBetween("2026-08-01", "2026-08-05")).toBe(4);
    // Ukraine changes clocks in late March; a naive local-time subtraction would give 30.5
    // days here and round wrong.
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
    expect(daysBetween("2026-08-05", "2026-08-01")).toBe(-4);
  });
});

describe("formatDayHeading", () => {
  it("prefers relative labels for today and yesterday", () => {
    expect(formatDayHeading("2026-08-05", "en", "2026-08-05")).toBe("Today");
    expect(formatDayHeading("2026-08-04", "en", "2026-08-05")).toBe("Yesterday");
    expect(formatDayHeading("2026-08-04", "uk", "2026-08-05")).toBe("Вчора");
  });

  it("uses a real date for anything older", () => {
    expect(formatDayHeading("2026-08-01", "en", "2026-08-05")).toContain("2026");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 7, 5, 12, 0, 0);

  it("collapses anything under a minute to 'just now'", () => {
    expect(formatRelativeTime(now - 30_000, "en", now)).toBe("just now");
  });

  it("uses the correct Slavic plural form for elapsed time", () => {
    expect(formatRelativeTime(now - 20 * 60_000, "uk", now)).toBe("20 хвилин тому");
    expect(formatRelativeTime(now - 2 * 60_000, "uk", now)).toBe("2 хвилини тому");
    expect(formatRelativeTime(now - 60_000, "uk", now)).toBe("1 хвилину тому");
  });

  it("steps up through hours and days", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, "en", now)).toBe("3 hours ago");
    expect(formatRelativeTime(now - 50 * 3_600_000, "en", now)).toBe("2 days ago");
  });
});

describe("formatBytes", () => {
  it("scales to a readable unit", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(2048, "en")).toBe("2 kB");
    expect(norm(formatBytes(7_340_032, "en"))).toBe("7 MB");
  });
});
