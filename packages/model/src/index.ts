import { z } from "zod";

// --- Subscription status (REQUIREMENTS FR-1.2) ---
export const ShowStatusSchema = z.enum(["Watching", "Backlog", "Paused", "Ended"]);
export type ShowStatus = z.infer<typeof ShowStatusSchema>;

// --- Canonical domain models (provider-agnostic, DESIGN §6) ---
export interface Show {
  tvmazeId: number;
  name: string;
  network: string | null;
  posterUrl: string | null;
  scheduleDays: string[];
  scheduleTime: string | null;
  /** Provider's own status string, e.g. TVMaze "Running" / "Ended". */
  showStatus: string | null;
  externals: { tvdb: number | null; imdb: string | null };
  lastSyncedAt: string | null;
}

export interface Season {
  id: string; // `${showId}:S${seasonNo}`
  showId: number;
  seasonNo: number; // 0 = Specials
  episodeOrder: number | null;
  premiereDate: string | null;
}

export type EpisodeType = "regular" | "significant_special" | "insignificant_special";

export interface Episode {
  tvmazeId: number;
  showId: number;
  seasonId: string;
  seasonNo: number;
  number: number | null; // null for some specials / daily shows
  title: string;
  airdate: string | null; // YYYY-MM-DD
  airtime: string | null; // HH:MM (origin timezone wall time)
  airstamp: string | null; // ISO8601 with offset — source of truth for sorting
  runtime: number | null;
  imageUrl: string | null;
  type: EpisodeType;
  /** Plain-text overview (TVMaze HTML stripped at ingest). */
  summary: string | null;
}

export interface Subscription {
  showId: number;
  status: ShowStatus;
  addedAt: string;
  /** Personal 1–5 rating, null = unrated. */
  rating: number | null;
  /** Private note, null/empty = none. */
  note: string | null;
}

export const UpcomingBucketSchema = z.enum([
  "This week",
  "Next week",
  "Later this month",
  "Next month",
  "60 days",
  "90+ days",
]);
export type UpcomingBucket = z.infer<typeof UpcomingBucketSchema>;

export interface UpcomingItem {
  showId: number;
  showName: string;
  posterUrl: string | null;
  seasonNo: number;
  epNo: number | null;
  title: string;
  summary: string | null;
  airstamp: string;
  centralDisplay: string;
  countdown: string;
  bucket: UpcomingBucket;
}

// --- API DTO schemas (DESIGN §5) ---
export const SubscribeBodySchema = z.object({
  tvmazeId: z.number().int().positive(),
});
export type SubscribeBody = z.infer<typeof SubscribeBodySchema>;

export const SetStatusBodySchema = z.object({
  status: ShowStatusSchema,
});
export type SetStatusBody = z.infer<typeof SetStatusBodySchema>;

/** PATCH /api/subscriptions/:id — all fields optional, at least one required. */
export const PatchSubscriptionBodySchema = z
  .object({
    status: ShowStatusSchema.optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.rating !== undefined || b.note !== undefined, {
    message: "nothing to update",
  });
export type PatchSubscriptionBody = z.infer<typeof PatchSubscriptionBodySchema>;

export interface StatsSummary {
  showsTotal: number;
  showsBehind: number;
  episodesBehind: number;
  minutesBehind: number;
}

export interface HistoryItem {
  showId: number;
  showName: string;
  posterUrl: string | null;
  seasonNo: number;
  epNo: number | null;
  title: string;
  watchedAt: string;
}

export const SetWatchedBodySchema = z.object({
  watched: z.boolean(),
});
export type SetWatchedBody = z.infer<typeof SetWatchedBodySchema>;

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
