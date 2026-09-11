import { z } from "zod";
import { ShowStatusSchema } from "@tvtrack/model";
import type { Stores } from "../store/sqlite/index.js";

// Import/export stub (REQUIREMENTS FR-4): JSON dump/restore of the full
// library keyed by TVMaze IDs. Round-trip must restore subscriptions +
// watched flags (acceptance criterion 6).

const ExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  shows: z.array(
    z.object({
      tvmazeId: z.number(),
      name: z.string(),
      network: z.string().nullable(),
      posterUrl: z.string().nullable(),
      scheduleDays: z.array(z.string()),
      scheduleTime: z.string().nullable(),
      // Optional so pre-rating/showStatus exports still import.
      showStatus: z.string().nullable().default(null),
      externals: z.object({
        tvdb: z.number().nullable(),
        imdb: z.string().nullable(),
      }),
      lastSyncedAt: z.string().nullable(),
    }),
  ),
  subscriptions: z.array(
    z.object({
      showId: z.number(),
      status: ShowStatusSchema,
      addedAt: z.string(),
      rating: z.number().int().min(1).max(5).nullable().default(null),
      note: z.string().nullable().default(null),
    }),
  ),
  seasons: z.array(
    z.object({
      id: z.string(),
      showId: z.number(),
      seasonNo: z.number(),
      episodeOrder: z.number().nullable(),
      premiereDate: z.string().nullable(),
    }),
  ),
  episodes: z.array(
    z.object({
      tvmazeId: z.number(),
      showId: z.number(),
      seasonId: z.string(),
      seasonNo: z.number(),
      number: z.number().nullable(),
      title: z.string(),
      airdate: z.string().nullable(),
      airtime: z.string().nullable(),
      airstamp: z.string().nullable(),
      runtime: z.number().nullable(),
      imageUrl: z.string().nullable(),
      type: z.enum(["regular", "significant_special", "insignificant_special"]),
      summary: z.string().nullable(),
    }),
  ),
  watched: z.array(
    z.union([
      // v0 shape: bare ids (date unknown — imports as backfill).
      z.number(),
      z.object({ episodeId: z.number(), watchedAt: z.string().nullable() }),
    ]),
  ),
});

export type ExportBlob = z.infer<typeof ExportSchema>;

export function exportData(stores: Stores): ExportBlob {
  const allShows = (
    stores.db.prepare(`SELECT tvmaze_id FROM shows ORDER BY tvmaze_id`).all() as unknown as {
      tvmaze_id: number;
    }[]
  )
    .map((r) => stores.shows.getShow(r.tvmaze_id))
    .filter((s) => s !== undefined);
  const subscriptions = (
    stores.db.prepare(`SELECT show_id, status, added_at, rating, note FROM subscriptions`).all() as unknown as {
      show_id: number;
      status: ExportBlob["subscriptions"][number]["status"];
      added_at: string;
      rating: number | null;
      note: string | null;
    }[]
  ).map((r) => ({ showId: r.show_id, status: r.status, addedAt: r.added_at, rating: r.rating, note: r.note }));
  const seasons = (
    stores.db.prepare(`SELECT * FROM seasons ORDER BY show_id, season_no`).all() as unknown as {
      id: string;
      show_id: number;
      season_no: number;
      episode_order: number | null;
      premiere_date: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    showId: r.show_id,
    seasonNo: r.season_no,
    episodeOrder: r.episode_order,
    premiereDate: r.premiere_date,
  }));
  const episodes = (
    stores.db.prepare(`SELECT * FROM episodes ORDER BY show_id, season_no, number`).all() as unknown as {
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
      type: ExportBlob["episodes"][number]["type"];
      summary: string | null;
    }[]
  ).map((r) => ({
    tvmazeId: r.tvmaze_id,
    showId: r.show_id,
    seasonId: r.season_id,
    seasonNo: r.season_no,
    number: r.number,
    title: r.title,
    airdate: r.airdate,
    airtime: r.airtime,
    airstamp: r.airstamp,
    runtime: r.runtime,
    imageUrl: r.image_url,
    type: r.type,
    summary: r.summary,
  }));
  const watched = (
    stores.db.prepare(`SELECT episode_id, watched_at FROM watched ORDER BY episode_id`).all() as unknown as {
      episode_id: number;
      watched_at: string | null;
    }[]
  ).map((r) => ({ episodeId: r.episode_id, watchedAt: r.watched_at }));
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    shows: allShows,
    subscriptions,
    seasons,
    episodes,
    watched,
  };
}

export function importData(stores: Stores, blob: unknown): { shows: number } {
  const data = ExportSchema.parse(blob);
  for (const s of data.shows) stores.shows.upsertShow(s);
  stores.seasons.upsertMany(data.seasons);
  stores.episodes.upsertMany(data.episodes);
  for (const sub of data.subscriptions) stores.subscriptions.add(sub);
  for (const w of data.watched) {
    if (typeof w === "number") {
      // Pre-date exports: unknown date → backfill (excluded from History)
      // rather than fabricating today.
      stores.watched.setWatched(w, true, null);
    } else {
      stores.watched.setWatched(w.episodeId, true, w.watchedAt);
    }
  }
  return { shows: data.shows.length };
}
