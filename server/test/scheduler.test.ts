import { describe, expect, it } from "vitest";
import { centralHour, shouldRun } from "../src/sync/scheduler.js";

describe("scheduler", () => {
  it("computes the Central hour (Sep = CDT, UTC-5)", () => {
    expect(centralHour(new Date("2026-09-11T08:00:00Z"))).toBe(3);
    expect(centralHour(new Date("2026-01-11T09:00:00Z"))).toBe(3); // CST, UTC-6
  });

  it("runs once per day at the configured hour", () => {
    const at3 = new Date("2026-09-11T08:00:00Z"); // 03:00 Central
    const at4 = new Date("2026-09-11T09:00:00Z");
    expect(shouldRun(null, at3, 3)).toBe(true);
    expect(shouldRun(null, at4, 3)).toBe(false);
    expect(shouldRun(at3.getTime(), at3, 3)).toBe(false);
    // Next day same hour, >20h later → run again.
    expect(
      shouldRun(at3.getTime(), new Date(at3.getTime() + 24 * 3_600_000), 3),
    ).toBe(true);
  });
});
