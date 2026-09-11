// Central-time helpers (REQUIREMENTS §3: fixed America/Chicago display).
// Clock is injectable so ScheduleService tests are deterministic.

export const CENTRAL_TZ = "America/Chicago";

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

const centralFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CENTRAL_TZ,
  dateStyle: "medium",
  timeStyle: "short",
});

/** "Sep 15, 2026, 7:00 PM" in Central, from a TVMaze airstamp. */
export function toCentralDisplay(airstamp: string): string {
  return centralFmt.format(new Date(airstamp));
}

/** "in 2d 4h" / "in 45m" / "aired". Pure function of two instants. */
export function countdown(airstamp: string, now: Date = new Date()): string {  const ms = new Date(airstamp).getTime() - now.getTime();
  if (ms <= 0) return "aired";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `in ${hours}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export type UpcomingBucketLabel =
  | "This week"
  | "Next week"
  | "Later this month"
  | "Next month"
  | "60 days"
  | "90+ days";

/**
 * Relative day-range buckets for the upcoming agenda. Calendar months vary,
 * so the month-ish buckets are fixed ranges — predictable and sortable.
 */
export function bucketFor(airstamp: string, now: Date = new Date()): UpcomingBucketLabel {
  const days = (new Date(airstamp).getTime() - now.getTime()) / 86_400_000;
  if (days < 7) return "This week";
  if (days < 14) return "Next week";
  if (days < 30) return "Later this month";
  if (days < 60) return "Next month";
  if (days < 90) return "60 days";
  return "90+ days";
}
