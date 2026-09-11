import { DatabaseSync } from "node:sqlite";
import type {
  Episode,
  HistoryItem,
  Season,
  Show,
  ShowStatus,
  Subscription,
} from "@tvtrack/model";
import type {
  EpisodeStore,
  SeasonStore,
  ShowStore,
  SubscriptionStore,
  WatchStore,
} from "../index.js";
import { SCHEMA, migrate } from "./schema.js";

export interface EpisodeWithShow extends Episode {
  showName: string;
  showPosterUrl: string | null;
}

interface ShowRow {
  tvmaze_id: number;
  name: string;
  network: string | null;
  poster_url: string | null;
  schedule_days: string;
  schedule_time: string | null;
  show_status: string | null;
  externals_tvdb: number | null;
  externals_imdb: string | null;
  last_synced_at: string | null;
}

interface EpisodeRow {
  tvmaze_id: number;
  show_id: number;
  season_id: string;
  season_no: number;
  number: number | null;
  title: string;
  airdate: string | null;
  airtime: string | null;
  airstamp: string | null;
  runtime: number | null;
  image_url: string | null;
  type: string;
  summary: string | null;
  show_name?: string;
  show_poster_url?: string | null;
}

function mapShow(row: ShowRow): Show {
  return {
    tvmazeId: row.tvmaze_id,
    name: row.name,
    network: row.network,
    posterUrl: row.poster_url,
    scheduleDays: JSON.parse(row.schedule_days) as string[],
    scheduleTime: row.schedule_time,
    showStatus: row.show_status,
    externals: { tvdb: row.externals_tvdb, imdb: row.externals_imdb },
    lastSyncedAt: row.last_synced_at,
  };
}

function mapEpisode(row: EpisodeRow): Episode {
  return {
    tvmazeId: row.tvmaze_id,
    showId: row.show_id,
    seasonId: row.season_id,
    seasonNo: row.season_no,
    number: row.number,
    title: row.title,
    airdate: row.airdate,
    airtime: row.airtime,
    airstamp: row.airstamp,
    runtime: row.runtime,
    imageUrl: row.image_url,
    type: row.type as Episode["type"],
    summary: row.summary,
  };
}

export class SqliteShowStore implements ShowStore {
  constructor(private db: DatabaseSync) {}

  upsertShow(show: Show): void {
    this.db
      .prepare(
        `INSERT INTO shows
           (tvmaze_id, name, network, poster_url, schedule_days, schedule_time,
            show_status, externals_tvdb, externals_imdb, last_synced_at)
         VALUES (:id, :name, :network, :poster, :days, :time, :showStatus,
                 :tvdb, :imdb, :synced)
         ON CONFLICT(tvmaze_id) DO UPDATE SET
           name = excluded.name, network = excluded.network,
           poster_url = excluded.poster_url, schedule_days = excluded.schedule_days,
           schedule_time = excluded.schedule_time, show_status = excluded.show_status,
           externals_tvdb = excluded.externals_tvdb,
           externals_imdb = excluded.externals_imdb,
           last_synced_at = excluded.last_synced_at`,
      )
      .run({
        id: show.tvmazeId,
        name: show.name,
        network: show.network,
        poster: show.posterUrl,
        days: JSON.stringify(show.scheduleDays),
        time: show.scheduleTime,
        showStatus: show.showStatus,
        tvdb: show.externals.tvdb,
        imdb: show.externals.imdb,
        synced: show.lastSyncedAt,
      });
  }

  getShow(showId: number): Show | undefined {
    const row = this.db
      .prepare(`SELECT * FROM shows WHERE tvmaze_id = ?`)
      .get(showId) as unknown as ShowRow | undefined;
    return row ? mapShow(row) : undefined;
  }

  listSubscribed(status?: ShowStatus): Show[] {
    const rows = (
      status
        ? this.db
            .prepare(
              `SELECT s.* FROM shows s
               JOIN subscriptions sub ON sub.show_id = s.tvmaze_id
               WHERE sub.status = ? ORDER BY s.name`,
            )
            .all(status)
        : this.db
            .prepare(
              `SELECT s.* FROM shows s
               JOIN subscriptions sub ON sub.show_id = s.tvmaze_id
               ORDER BY s.name`,
            )
            .all()
    ) as unknown as ShowRow[];
    return rows.map(mapShow);
  }
}

export class SqliteSubscriptionStore implements SubscriptionStore {
  constructor(private db: DatabaseSync) {}

  add(sub: Subscription): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (show_id, status, added_at, rating, note)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(show_id) DO UPDATE SET
           status = excluded.status, added_at = excluded.added_at,
           rating = excluded.rating, note = excluded.note`,
      )
      .run(sub.showId, sub.status, sub.addedAt, sub.rating, sub.note);
  }

  remove(showId: number): void {
    // Cascading deletes (seasons/episodes/watched/sync_meta) are handled by
    // deleting the show row itself; subscriptions + watched are cleared here
    // first so ordering never violates FKs.
    this.db.prepare(`DELETE FROM watched WHERE episode_id IN
      (SELECT tvmaze_id FROM episodes WHERE show_id = ?)`).run(showId);
    this.db.prepare(`DELETE FROM subscriptions WHERE show_id = ?`).run(showId);
    this.db.prepare(`DELETE FROM episodes WHERE show_id = ?`).run(showId);
    this.db.prepare(`DELETE FROM seasons WHERE show_id = ?`).run(showId);
    this.db.prepare(`DELETE FROM sync_meta WHERE show_id = ?`).run(showId);
    this.db.prepare(`DELETE FROM shows WHERE tvmaze_id = ?`).run(showId);
  }

  setStatus(showId: number, status: ShowStatus): void {
    this.db
      .prepare(`UPDATE subscriptions SET status = ? WHERE show_id = ?`)
      .run(status, showId);
  }

  patch(
    showId: number,
    patch: { status?: ShowStatus; rating?: number | null; note?: string | null },
  ): void {
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if (patch.status !== undefined) {
      sets.push("status = ?");
      vals.push(patch.status);
    }
    if (patch.rating !== undefined) {
      sets.push("rating = ?");
      vals.push(patch.rating);
    }
    if (patch.note !== undefined) {
      const note = patch.note?.trim() ? patch.note.trim() : null;
      sets.push("note = ?");
      vals.push(note);
    }
    if (sets.length === 0) return;
    vals.push(showId);
    this.db
      .prepare(`UPDATE subscriptions SET ${sets.join(", ")} WHERE show_id = ?`)
      .run(...vals);
  }

  get(showId: number): Subscription | undefined {
    const row = this.db
      .prepare(`SELECT show_id, status, added_at, rating, note FROM subscriptions WHERE show_id = ?`)
      .get(showId) as
      | { show_id: number; status: ShowStatus; added_at: string; rating: number | null; note: string | null }
      | undefined;
    return row
      ? {
          showId: row.show_id,
          status: row.status,
          addedAt: row.added_at,
          rating: row.rating,
          note: row.note,
        }
      : undefined;
  }
}

export class SqliteSeasonStore implements SeasonStore {
  constructor(private db: DatabaseSync) {}

  upsertMany(seasons: Season[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO seasons (id, show_id, season_no, episode_order, premiere_date)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         episode_order = excluded.episode_order,
         premiere_date = excluded.premiere_date`,
    );
    for (const s of seasons) {
      stmt.run(s.id, s.showId, s.seasonNo, s.episodeOrder, s.premiereDate);
    }
  }

  listByShow(showId: number): Season[] {
    const rows = this.db
      .prepare(
        `SELECT id, show_id, season_no, episode_order, premiere_date
         FROM seasons WHERE show_id = ? ORDER BY season_no`,
      )
      .all(showId) as unknown as {
      id: string;
      show_id: number;
      season_no: number;
      episode_order: number | null;
      premiere_date: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      showId: r.show_id,
      seasonNo: r.season_no,
      episodeOrder: r.episode_order,
      premiereDate: r.premiere_date,
    }));
  }
}

export class SqliteEpisodeStore implements EpisodeStore {
  constructor(private db: DatabaseSync) {}

  upsertMany(episodes: Episode[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO episodes
         (tvmaze_id, show_id, season_id, season_no, number, title,
          airdate, airtime, airstamp, runtime, image_url, type, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tvmaze_id) DO UPDATE SET
         season_id = excluded.season_id, season_no = excluded.season_no,
         number = excluded.number, title = excluded.title,
         airdate = excluded.airdate, airtime = excluded.airtime,
         airstamp = excluded.airstamp, runtime = excluded.runtime,
         image_url = excluded.image_url, type = excluded.type,
         summary = excluded.summary`,
    );
    for (const e of episodes) {
      stmt.run(
        e.tvmazeId,
        e.showId,
        e.seasonId,
        e.seasonNo,
        e.number,
        e.title,
        e.airdate,
        e.airtime,
        e.airstamp,
        e.runtime,
        e.imageUrl,
        e.type,
        e.summary,
      );
    }
  }

  listFutureSubscribed(
    nowIso: string,
    limit: number,
    offset: number,
  ): EpisodeWithShow[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, s.name AS show_name, s.poster_url AS show_poster_url
         FROM episodes e
         JOIN subscriptions sub ON sub.show_id = e.show_id
         JOIN shows s ON s.tvmaze_id = e.show_id
         WHERE e.airstamp IS NOT NULL AND e.airstamp > ?
         ORDER BY e.airstamp ASC LIMIT ? OFFSET ?`,
      )
      .all(nowIso, limit, offset) as unknown as EpisodeRow[];
    return rows.map((r) => ({
      ...mapEpisode(r),
      showName: r.show_name ?? "",
      showPosterUrl: r.show_poster_url ?? null,
    }));
  }

  listBySeason(seasonId: string): Episode[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM episodes WHERE season_id = ?
         ORDER BY number IS NULL, number ASC, airstamp ASC`,
      )
      .all(seasonId) as unknown as EpisodeRow[];
    return rows.map(mapEpisode);
  }

  listByShow(showId: number): Episode[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM episodes WHERE show_id = ?
         ORDER BY season_no ASC, number IS NULL, number ASC`,
      )
      .all(showId) as unknown as EpisodeRow[];
    return rows.map(mapEpisode);
  }
}

export class SqliteWatchStore implements WatchStore {
  constructor(private db: DatabaseSync) {}

  isWatched(episodeId: number): boolean {
    const row = this.db
      .prepare(`SELECT watched FROM watched WHERE episode_id = ?`)
      .get(episodeId) as unknown as { watched: number } | undefined;
    return row?.watched === 1;
  }

  setWatched(episodeId: number, watched: boolean, at?: string | null): void {
    if (watched) {
      // INSERT OR IGNORE: first-watch date wins. Re-marking an already
      // watched episode (e.g. gap-fill over it) keeps the original date.
      // Unwatch deletes the row, so a later re-watch records a new date.
      // at === undefined stamps now; null records an explicitly unknown date.
      this.db
        .prepare(
          `INSERT INTO watched (episode_id, watched, watched_at)
           VALUES (?, 1, ?) ON CONFLICT(episode_id) DO NOTHING`,
        )
        .run(episodeId, at === undefined ? new Date().toISOString() : at);
    } else {
      this.db
        .prepare(`DELETE FROM watched WHERE episode_id = ?`)
        .run(episodeId);
    }
  }

  setSeasonWatched(seasonId: string, watched: boolean): void {
    const rows = this.db
      .prepare(`SELECT tvmaze_id FROM episodes WHERE season_id = ?`)
      .all(seasonId) as unknown as { tvmaze_id: number }[];
    // Bulk backfill: new rows get NULL watched_at (excluded from History),
    // and existing per-episode dates are never overwritten.
    const stmt = this.db.prepare(
      `INSERT INTO watched (episode_id, watched, watched_at) VALUES (?, 1, NULL)
       ON CONFLICT(episode_id) DO NOTHING`,
    );
    if (watched) {
      for (const r of rows) stmt.run(r.tvmaze_id);
    } else {
      this.db
        .prepare(
          `DELETE FROM watched WHERE episode_id IN
           (SELECT tvmaze_id FROM episodes WHERE season_id = ?)`,
        )
        .run(seasonId);
    }
  }

  clearForShow(showId: number): void {
    this.db
      .prepare(
        `DELETE FROM watched WHERE episode_id IN
         (SELECT tvmaze_id FROM episodes WHERE show_id = ?)`,
      )
      .run(showId);
  }

  /** Watched flags for a set of episodes in one query (progress views). */
  watchedSet(episodeIds: number[]): Set<number> {
    if (episodeIds.length === 0) return new Set();
    const placeholders = episodeIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT episode_id FROM watched WHERE episode_id IN (${placeholders})`,
      )
      .all(...episodeIds) as unknown as { episode_id: number }[];
    return new Set(rows.map((r) => r.episode_id));
  }

  /**
   * Watch history, most recent first. Only rows with a watched_at date —
   * bulk season backfills (NULL) are excluded by construction.
   */
  listHistory(limit: number, offset: number): HistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT e.show_id, s.name AS show_name, s.poster_url AS show_poster,
                e.season_no, e.number, e.title, w.watched_at
         FROM watched w
         JOIN episodes e ON e.tvmaze_id = w.episode_id
         JOIN shows s ON s.tvmaze_id = e.show_id
         WHERE w.watched_at IS NOT NULL
         ORDER BY w.watched_at DESC, e.tvmaze_id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as unknown as {
      show_id: number;
      show_name: string;
      show_poster: string | null;
      season_no: number;
      number: number | null;
      title: string;
      watched_at: string;
    }[];
    return rows.map((r) => ({
      showId: r.show_id,
      showName: r.show_name,
      posterUrl: r.show_poster,
      seasonNo: r.season_no,
      epNo: r.number,
      title: r.title,
      watchedAt: r.watched_at,
    }));
  }
}

export interface Stores {
  db: DatabaseSync;
  shows: SqliteShowStore;
  subscriptions: SqliteSubscriptionStore;
  seasons: SqliteSeasonStore;
  episodes: SqliteEpisodeStore;
  watched: SqliteWatchStore;
}

export function openStores(path: string): Stores {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);
  return {
    db,
    shows: new SqliteShowStore(db),
    subscriptions: new SqliteSubscriptionStore(db),
    seasons: new SqliteSeasonStore(db),
    episodes: new SqliteEpisodeStore(db),
    watched: new SqliteWatchStore(db),
  };
}
