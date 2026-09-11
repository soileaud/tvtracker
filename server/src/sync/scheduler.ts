import type { Stores } from "../store/sqlite/index.js";
import type { SyncService } from "./index.js";

// Nightly auto-refresh. In-process and deliberately dumb: every `checkMs`
// it asks shouldRun(); once a day, at REFRESH_HOUR Central, it refreshes
// each subscribed show sequentially with a pause between shows to stay
// under TVMaze's 20 req / 10s limit. Disabled with AUTO_REFRESH=false.

export interface SchedulerOptions {
  hourCentral?: number;
  checkMs?: number;
  delayBetweenMs?: number;
}

export const DEFAULTS = {
  hourCentral: 3,
  checkMs: 15 * 60 * 1000,
  delayBetweenMs: 1500,
} as const;

const centralHourFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  hour12: false,
});

export function centralHour(now: Date): number {
  return Number(centralHourFmt.format(now)) % 24;
}

export function shouldRun(
  lastRunMs: number | null,
  now: Date,
  hourCentral: number,
): boolean {
  if (centralHour(now) !== hourCentral) return false;
  if (lastRunMs === null) return true;
  return now.getTime() - lastRunMs > 20 * 3_600_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startAutoRefresh(
  stores: Stores,
  sync: SyncService,
  opts: SchedulerOptions = {},
  clock: () => Date = () => new Date(),
): () => void {
  const { hourCentral, checkMs, delayBetweenMs } = { ...DEFAULTS, ...opts };
  let lastRunMs: number | null = null;
  let running = false;

  const tick = async () => {
    if (running || !shouldRun(lastRunMs, clock(), hourCentral)) return;
    running = true;
    try {
      const shows = stores.shows.listSubscribed();
      for (const s of shows) {
        try {
          await sync.refreshShow(s.tvmazeId);
        } catch {
          // One failing show must not cancel the rest of the night.
        }
        await sleep(delayBetweenMs);
      }
      lastRunMs = clock().getTime();
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), checkMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
