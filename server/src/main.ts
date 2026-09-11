import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStores, type Stores } from "./store/sqlite/index.js";
import { TVMazeAdapter } from "./providers/tvmaze/index.js";
import type { ShowProvider } from "./providers/index.js";
import { SyncService } from "./sync/index.js";
import { startAutoRefresh } from "./sync/scheduler.js";
import { SonarrClient } from "./sonarr/index.js";
import { registerApi, type ApiDeps } from "./api/index.js";

const PORT = Number(process.env.PORT ?? 3001);
const DB_PATH =
  process.env.DB_PATH ?? join(process.cwd(), "data", "tvtrack.db");
const REFRESH_HOUR = Number(process.env.REFRESH_HOUR ?? 3);

// Composition root (DESIGN §3.8): the ONLY place that news up TVMaze +
// SQLite concretions. Everything else depends on interfaces.
export function buildApp(overrides?: Partial<ApiDeps>): {
  app: FastifyInstance;
  deps: ApiDeps;
} {
  let deps: ApiDeps;
  if (overrides) {
    deps = {
      stores: overrides.stores!,
      provider: overrides.provider!,
      sync: overrides.sync!,
      sonarr: overrides.sonarr ?? null,
    };
  } else {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    const stores: Stores = openStores(DB_PATH);
    const provider: ShowProvider = new TVMazeAdapter();
    deps = {
      stores,
      provider,
      sync: new SyncService(stores, provider),
      sonarr: SonarrClient.fromEnv(),
    };
  }

  const app = Fastify({ logger: true });
  app.get("/api/health", async () => ({ ok: true }));
  // Tolerate empty bodies under application/json (treat as {}): some
  // clients send the content-type header on bodyless POSTs, which Fastify
  // rejects by default. Handlers still validate via Zod.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      if (body === "") return done(null, {});
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error);
      }
    },
  );
  registerApi(app, deps);

  // In production the API process also serves the Vue build (DESIGN §0).
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = join(here, "..", "..", "client", "dist");
  if (existsSync(dist)) {
    app.register(fastifyStatic, { root: dist });
    // SPA fallback (Vue Router createWebHistory): serve index.html for
    // non-API GETs like /library, /upcoming, /shows/:id so refresh,
    // direct links, and PWA launches work. /api/* keeps JSON 404s.
    app.setNotFoundHandler((req, reply) => {
      const url = req.url ?? "";
      if (url === "/api" || url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not found" });
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return { app, deps };
}

// Only listen when executed directly (not when imported by tests).
const entry = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : "";
if (import.meta.url === entry) {
  const { app, deps } = buildApp();
  if (process.env.AUTO_REFRESH !== "false") {
    startAutoRefresh(deps.stores, deps.sync, { hourCentral: REFRESH_HOUR });
    app.log.info(`auto-refresh on (Central hour ${REFRESH_HOUR}, AUTO_REFRESH=false to disable)`);
  }
  if (deps.sonarr) app.log.info("sonarr integration on");
  app.listen({ port: PORT, host: "0.0.0.0" });
}
