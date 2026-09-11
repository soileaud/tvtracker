import type { FastifyInstance, FastifyReply } from "fastify";
import {
  PaginationQuerySchema,
  PatchSubscriptionBodySchema,
  SetWatchedBodySchema,
  ShowStatusSchema,
  SubscribeBodySchema,
  type ShowStatus,
} from "@tvtrack/model";
import type { ShowProvider } from "../providers/index.js";
import type { Stores } from "../store/sqlite/index.js";
import type { SyncService } from "../sync/index.js";
import type { SonarrClient } from "../sonarr/index.js";
import { getUpcoming } from "../domain/schedule.js";
import { getStats } from "../domain/stats.js";
import {
  markUpToHere,
  nextUnwatched,
  seasonProgress,
  showProgress,
} from "../domain/watch.js";
import { unsubscribe } from "../domain/subscription.js";
import { exportData, importData } from "../io/index.js";

// API layer (DESIGN §3.2): thin HTTP translation only. Each handler calls
// exactly one domain/sync/io service — no SQL, no provider calls here
// (except search, which is a read-through with no DB write).

export interface ApiDeps {
  stores: Stores;
  provider: ShowProvider;
  sync: SyncService;
  sonarr?: SonarrClient | null;
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: message });
}

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  const { stores, provider, sync } = deps;

  // --- Search (read-through, no DB write) ---
  app.get("/api/search", async (req, reply) => {
    const q = (req.query as { q?: string }).q?.trim();
    if (!q) return badRequest(reply, "missing ?q=");
    return provider.searchShows(q);
  });

  // --- Subscriptions ---
  app.get("/api/subscriptions", async (req) => {
    const raw = (req.query as { status?: string }).status;
    const parsed = ShowStatusSchema.optional().safeParse(raw);
    const status: ShowStatus | undefined = parsed.success ? parsed.data : undefined;
    return stores.shows.listSubscribed(status).map((show) => {
      const next = nextUnwatched(stores, show.tvmazeId);
      return {
        show,
        status: stores.subscriptions.get(show.tvmazeId)?.status,
        progress: showProgress(stores, show.tvmazeId),
        nextUnwatched: next
          ? {
              tvmazeId: next.tvmazeId,
              seasonNo: next.seasonNo,
              number: next.number,
              title: next.title,
              airstamp: next.airstamp,
            }
          : null,
      };
    });
  });

  app.post("/api/subscriptions", async (req, reply) => {
    const parsed = SubscribeBodySchema.extend({
      status: ShowStatusSchema.default("Watching"),
    }).safeParse(req.body);
    if (!parsed.success) return badRequest(reply, "expected { tvmazeId, status? }");
    await sync.subscribe(parsed.data.tvmazeId, parsed.data.status);
    return { ok: true, showId: parsed.data.tvmazeId };
  });

  app.patch("/api/subscriptions/:id", async (req, reply) => {
    const parsed = PatchSubscriptionBodySchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, "expected { status?, rating?, note? }");
    const showId = Number((req.params as { id: string }).id);
    if (!stores.subscriptions.get(showId)) return notFound(reply, "not subscribed");
    stores.subscriptions.patch(showId, parsed.data);
    return { ok: true };
  });

  app.delete("/api/subscriptions/:id", async (req) => {
    unsubscribe(stores, Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // --- History (individually-marked watches, most recent first) ---
  app.get("/api/history", async (req) => {
    const query = PaginationQuerySchema.parse(req.query);
    const items = stores.watched.listHistory(query.limit, query.offset);
    return { items, nextOffset: query.offset + items.length };
  });

  // --- Upcoming (FR-2) ---
  app.get("/api/upcoming", async (req) => {
    const query = PaginationQuerySchema.parse(req.query);
    const items = getUpcoming(stores.episodes, query);
    return { items, nextOffset: query.offset + items.length };
  });

  // --- Show detail (FR-3) ---
  app.get("/api/shows/:id", async (req, reply) => {
    const showId = Number((req.params as { id: string }).id);
    const show = stores.shows.getShow(showId);
    if (!show) {
      return notFound(reply, "unknown show");
    }
    const seasons = stores.seasons.listByShow(showId).map((season) => ({
      season,
      episodes: stores.episodes.listBySeason(season.id).map((e) => ({
        ...e,
        watched: stores.watched.isWatched(e.tvmazeId),
      })),
      progress: seasonProgress(stores, season.id),
    }));
    return {
      show,
      status: stores.subscriptions.get(showId)?.status ?? null,
      rating: stores.subscriptions.get(showId)?.rating ?? null,
      note: stores.subscriptions.get(showId)?.note ?? null,
      progress: showProgress(stores, showId),
      nextUnwatched: nextUnwatched(stores, showId) ?? null,
      seasons,
    };
  });

  // --- Stats-lite ---
  app.get("/api/stats", async () => getStats(stores, new Date().toISOString()));

  // --- Sonarr (optional; 200 with configured:false when unset) ---
  app.get("/api/sonarr/status/:showId", async (req, reply) => {
    if (!deps.sonarr) return { configured: false };
    const show = stores.shows.getShow(Number((req.params as { showId: string }).showId));
    if (!show) return notFound(reply, "unknown show");
    const tvdb = show.externals.tvdb;
    if (!tvdb) return { configured: true, matched: false, reason: "no-tvdb-id" };
    try {
      return { configured: true, ...(await deps.sonarr.statusForTvdb(tvdb)) };
    } catch (err) {
      return badRequest(reply, `sonarr unreachable: ${(err as Error).message}`);
    }
  });

  app.get("/api/sonarr/episodes/:showId", async (req, reply) => {
    if (!deps.sonarr) return { configured: false };
    const show = stores.shows.getShow(Number((req.params as { showId: string }).showId));
    if (!show) return notFound(reply, "unknown show");
    const tvdb = show.externals.tvdb;
    if (!tvdb) return { configured: true, matched: false, reason: "no-tvdb-id" };
    try {
      const status = await deps.sonarr.statusForTvdb(tvdb);
      return { configured: true, matched: status.matched, files: status.files ?? [] };
    } catch (err) {
      return badRequest(reply, `sonarr unreachable: ${(err as Error).message}`);
    }
  });

  // --- Watched tracking (FR-3) ---
  app.patch("/api/episodes/:id", async (req, reply) => {
    const parsed = SetWatchedBodySchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, "expected { watched }");
    stores.watched.setWatched(Number((req.params as { id: string }).id), parsed.data.watched);
    return { ok: true };
  });

  app.post("/api/seasons/:id/watched", async (req, reply) => {
    const parsed = SetWatchedBodySchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, "expected { watched }");
    stores.watched.setSeasonWatched(
      decodeURIComponent((req.params as { id: string }).id),
      parsed.data.watched,
    );
    return { ok: true };
  });

  app.post("/api/episodes/:id/watch-up-to-here", async (req, reply) => {
    try {
      markUpToHere(stores, Number((req.params as { id: string }).id));
    } catch {
      return notFound(reply, "unknown episode");
    }
    return { ok: true };
  });

  // Drop the watch date but stay watched (backfill without History clutter).
  app.post("/api/episodes/:id/clear-date", async (req) => {
    stores.watched.clearWatchedAt(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // --- Refresh ---
  app.post("/api/refresh/:showId", async (req) => {
    await sync.refreshShow(Number((req.params as { showId: string }).showId));
    return { ok: true };
  });

  app.post("/api/refresh-all", async () => {
    return sync.refreshAll();
  });

  // --- Import/export stub (FR-4) ---
  app.get("/api/export", async () => exportData(stores));

  app.post("/api/import", async (req, reply) => {
    try {
      return importData(stores, req.body);
    } catch {
      return badRequest(reply, "invalid import blob (expected version-1 export JSON)");
    }
  });
}
