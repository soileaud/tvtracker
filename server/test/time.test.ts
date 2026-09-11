import { describe, expect, it } from "vitest";
import { bucketFor, countdown, toCentralDisplay } from "../src/platform/time.js";

describe("countdown", () => {
  const now = new Date("2026-09-11T12:00:00-05:00");
  it("returns aired for past timestamps", () => {
    expect(countdown("2026-09-10T20:00:00-05:00", now)).toBe("aired");
  });
  it("formats minutes and hours", () => {
    expect(countdown("2026-09-11T12:45:00-05:00", now)).toBe("in 45m");
    expect(countdown("2026-09-11T15:30:00-05:00", now)).toBe("in 3h 30m");
  });
  it("formats days", () => {
    expect(countdown("2026-09-13T14:00:00-05:00", now)).toBe("in 2d 2h");
  });
});

describe("toCentralDisplay", () => {
  it("renders a Central datetime string", () => {
    const s = toCentralDisplay("2026-09-15T20:00:00-05:00");
    expect(s).toContain("2026");
  });
});

describe("bucketFor", () => {
  const now = new Date("2026-09-11T12:00:00-05:00");
  const plusDays = (d: number) =>
    new Date(now.getTime() + d * 86_400_000).toISOString();
  it("buckets by relative day ranges", () => {
    expect(bucketFor(plusDays(1), now)).toBe("This week");
    expect(bucketFor(plusDays(6.9), now)).toBe("This week");
    expect(bucketFor(plusDays(7), now)).toBe("Next week");
    expect(bucketFor(plusDays(13), now)).toBe("Next week");
    expect(bucketFor(plusDays(14), now)).toBe("Later this month");
    expect(bucketFor(plusDays(29), now)).toBe("Later this month");
    expect(bucketFor(plusDays(30), now)).toBe("Next month");
    expect(bucketFor(plusDays(59), now)).toBe("Next month");
    expect(bucketFor(plusDays(60), now)).toBe("60 days");
    expect(bucketFor(plusDays(89), now)).toBe("60 days");
    expect(bucketFor(plusDays(90), now)).toBe("90+ days");
    expect(bucketFor(plusDays(400), now)).toBe("90+ days");
  });
});
