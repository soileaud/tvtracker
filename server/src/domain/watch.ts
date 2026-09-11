import type { Episode } from "@tvtrack/model";
import type { Stores } from "../store/sqlite/index.js";

// Watched-tracking use-cases (REQUIREMENTS FR-3). Boolean flags only.

// Show air order: season ascending, null episode numbers sort last within
// the season (specials/daily anomalies), airstamp as final tiebreak.
export function airOrder(episodes: Episode[]): Episode[] {
  return [...episodes].sort((a, b) => {
    if (a.seasonNo !== b.seasonNo) return a.seasonNo - b.seasonNo;
    if ((a.number ?? null) !== (b.number ?? null)) {
      if (a.number == null) return 1;
      if (b.number == null) return -1;
      if (a.number !== b.number) return a.number - b.number;
    }
    return (a.airstamp ?? "").localeCompare(b.airstamp ?? "");
  });
}

export function setEpisodeWatched(
  stores: Stores,
  episodeId: number,
  watched: boolean,
): void {
  stores.watched.setWatched(episodeId, watched);
}

export function setSeasonWatched(
  stores: Stores,
  seasonId: string,
  watched: boolean,
): void {
  stores.watched.setSeasonWatched(seasonId, watched);
}

/** Mark target episode and every episode before it in show air order. */
export function markUpToHere(stores: Stores, episodeId: number): void {
  const target = stores.db
    .prepare(`SELECT show_id FROM episodes WHERE tvmaze_id = ?`)
    .get(episodeId) as unknown as { show_id: number } | undefined;
  if (!target) throw new Error(`unknown episode: ${episodeId}`);
  const ordered = airOrder(stores.episodes.listByShow(target.show_id));
  // One timestamp for the whole gap-fill so History shows it as one session.
  const at = new Date().toISOString();
  for (const ep of ordered) {
    stores.watched.setWatched(ep.tvmazeId, true, at);
    if (ep.tvmazeId === episodeId) break;
  }
}

export interface Progress {
  watched: number;
  total: number;
}

export function seasonProgress(
  stores: Stores,
  seasonId: string,
): Progress {
  const eps = stores.episodes.listBySeason(seasonId);
  const set = stores.watched.watchedSet(eps.map((e) => e.tvmazeId));
  return { watched: set.size, total: eps.length };
}

export function showProgress(stores: Stores, showId: number): Progress {
  const eps = stores.episodes.listByShow(showId);
  const set = stores.watched.watchedSet(eps.map((e) => e.tvmazeId));
  return { watched: set.size, total: eps.length };
}

/** First episode in air order with watched=false (may be unaired). */
export function nextUnwatched(
  stores: Stores,
  showId: number,
): Episode | undefined {
  const ordered = airOrder(stores.episodes.listByShow(showId));
  const set = stores.watched.watchedSet(ordered.map((e) => e.tvmazeId));
  return ordered.find((e) => !set.has(e.tvmazeId));
}
