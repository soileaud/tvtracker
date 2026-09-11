import type { Episode, PaginationQuery, UpcomingItem } from "@tvtrack/model";
import type { Clock } from "../platform/time.js";
import { bucketFor, countdown, systemClock, toCentralDisplay } from "../platform/time.js";

// Upcoming agenda (REQUIREMENTS FR-2): future airings only, soonest first.
// The source port is satisfied structurally by SqliteEpisodeStore.

export interface UpcomingSource {
  listFutureSubscribed(
    nowIso: string,
    limit: number,
    offset: number,
  ): (Episode & { showName: string; showPosterUrl: string | null })[];
}

export function getUpcoming(
  source: UpcomingSource,
  query: PaginationQuery,
  clock: Clock = systemClock,
): UpcomingItem[] {
  const now = clock();
  const rows = source.listFutureSubscribed(
    now.toISOString(),
    query.limit,
    query.offset,
  );
  return rows.map((e) => ({
    showId: e.showId,
    showName: e.showName,
    posterUrl: e.showPosterUrl,
    seasonNo: e.seasonNo,
    epNo: e.number,
    title: e.title,
    summary: e.summary,
    // airstamp is non-null here by construction of the store query
    airstamp: e.airstamp as string,
    centralDisplay: toCentralDisplay(e.airstamp as string),
    countdown: countdown(e.airstamp as string, now),
    bucket: bucketFor(e.airstamp as string, now),
  }));
}
