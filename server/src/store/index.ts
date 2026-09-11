import type { Episode, HistoryItem, Season, Show, ShowStatus, Subscription } from "@tvtrack/model";

// Persistence ports (DESIGN §3.6). SQLite implements these; domain depends
// only on the interfaces so storage stays swappable.

export interface ShowStore {
  upsertShow(show: Show): void;
  getShow(showId: number): Show | undefined;
  listSubscribed(status?: ShowStatus): Show[];
}

export interface EpisodeStore {
  upsertMany(episodes: Episode[]): void;
  /** Future airings for subscribed shows, ascending by airstamp. */
  listFutureSubscribed(nowIso: string, limit: number, offset: number): Episode[];
  listBySeason(seasonId: string): Episode[];
}

export interface SeasonStore {
  upsertMany(seasons: Season[]): void;
  listByShow(showId: number): Season[];
}

export interface WatchStore {
  isWatched(episodeId: number): boolean;
  setWatched(episodeId: number, watched: boolean, at?: string | null): void;
  setSeasonWatched(seasonId: string, watched: boolean): void;
  /** Keep the episode watched but drop its date (leaves History, like backfills). */
  clearWatchedAt(episodeId: number): void;
  clearForShow(showId: number): void;
  listHistory(limit: number, offset: number): HistoryItem[];
}

export interface SubscriptionStore {
  add(sub: Subscription): void;
  remove(showId: number): void;
  setStatus(showId: number, status: ShowStatus): void;
  patch(
    showId: number,
    patch: { status?: ShowStatus; rating?: number | null; note?: string | null },
  ): void;
  get(showId: number): Subscription | undefined;
}
