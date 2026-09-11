# TVTrack - High-Level Design

## 0. Locked Stack (2026-09-11)
- **Runtime:** Node 24 LTS (current env has 18.17.1 — upgrade required, see §9)
- **Backend:** TypeScript (strict) + Fastify 5 + `node:sqlite` (Node 24 built-in, no native build — avoids missing CLT issue) + Zod for DTO validation
- **Frontend:** Vue 3 (Composition API, `<script setup>`) + Vite 6 + Vue Router, plain CSS mobile-first (no UI framework in v1)
- **Shared:** `packages/model/` TS types (Show/Season/Episode/Subscription/DTOs) imported by both sides
- **Test:** Vitest (+ Vue Test Utils for components)
- Single deploy: Fastify serves `client/dist/` + `/api/*` on one LAN port.

## 1. Design Principles
1. **Decoupled & modular:** each component owns one domain, communicates via narrow interfaces. No direct cross-module imports.
2. **Ports-and-adapters:** domain services depend on interfaces (`ShowProvider`, `ShowStore`), not on TVMaze / SQLite concretions. Providers and storage are swappable.
3. **Single shared state:** one server + SQLite file is source of truth for all LAN clients. Last-write-wins, no OT/CRDT.
4. **Cache-first reads:** UI never calls TVMaze directly. All reads come from local DB; sync jobs refresh the cache.
5. **Testability:** pure domain logic (sorting, progress, up-to-here) has no I/O; I/O lives in adapters with fakes for tests.
6. **YAGNI:** no auth, no notifications, no discovery, no stats. Stubs only for import/export and artwork.

## 2. System Overview

```
[ Mobile / Desktop Browser ]
           |  HTTP JSON (LAN)
           v
[ API Layer ] -> [ Domain Services ] -> [ Store Interfaces ] -> [ SQLite ]
                      |                       ^
                      v                       |
               [ Provider Interfaces ] -> [ TVMaze Adapter ]
                      ^
                      | (future stub)
               [ Artwork Adapter ]
[ Sync Service ] (manual refresh, uses Providers + Stores)
[ Import/Export Service ] (JSON dump/restore via Stores)
```

Deploy as one server process serving both static frontend and `/api/*`. SQLite file alongside server for trivial backup.

## 3. Components

### 3.1 Web Client (`client/`)
- **Responsibility:** responsive mobile-friendly UI only. No business logic beyond presentation. Three views: Library, Upcoming, Show Detail (season tabs).
- **Depends on:** HTTP API only. No direct TVMaze, no SQL.
- **Interface out:** `GET/POST/PATCH/DELETE /api/*` (see §5).
- **Replaceable with:** any HTTP client; keep view models DTO-shaped so native/CLI could reuse API.

### 3.2 API Layer (`server/api/`)
- **Responsibility:** thin HTTP translation: validate input, call one domain service, serialize DTO. No SQL, no TVMaze calls, no date math.
- **Endpoints:** subscriptions, shows, upcoming, episodes/seasons watched, refresh triggers, export/import (see §5).
- **Depends on:** domain service interfaces only.
- **Decoupling rule:** one handler = one service call. Pagination (`limit/offset`) enforced here.

### 3.3 Domain Services (`server/domain/`) — pure, no I/O
Independent, separately testable:

- **SubscriptionService**
  - `subscribe(showSnapshot)`, `unsubscribe(showId)`, `setStatus(showId, status)`
  - Rules: default status `Watching`; valid statuses `Watching|Backlog|Paused|Ended`; unsubscribe deletes watched rows for that show.
  - Depends on: `ShowStore`, `WatchStore` interfaces.

- **ScheduleService (Upcoming)**
  - `getUpcoming(now, limit, offset) -> EpisodeDTO[]` sorted by `airstamp ASC`, `airstamp > now`, subscribed shows only.
  - Pure sort/filter; timezone formatting delegated to `TimeService`.
  - Depends on: `EpisodeStore` read interface.

- **WatchService (Tracking)**
  - `setWatched(episodeId, bool)`, `setSeasonWatched(seasonId, bool)`, `markUpToHere(episodeId)`
  - `getSeasonProgress(seasonId) -> {watched,total}`, `getShowProgress(showId)`, `getNextUnwatched(showId) -> episodeId?`
  - Rules: `markUpToHere` = all episodes in air order `<= target` set watched; specials (S00) counted in totals; `nextUnwatched` = first in air order with `watched=false`.
  - Depends on: `WatchStore`, `EpisodeStore`. No provider knowledge.

### 3.4 Provider Abstraction (`server/providers/`)
Isolates all external TV data so TVMaze can be replaced without touching domain/API.

```ts
interface ShowProvider {
  searchShows(query: string): Promise<ShowSummary[]>;
  getShowDetail(providerShowId: string): Promise<ShowDetail>; // show+seasons+episodes incl. specials
  getFullSchedule(): Promise<ProviderEpisode[]>; // optional, for bulk refresh
}
interface ArtworkProvider {
  getPoster(showId: string): Promise<ImageRef | null>; // stub for future TMDB
}
```

- **TVMazeAdapter implements ShowProvider:** maps `search/shows`, `shows/:id`, `shows/:id/seasons`, `shows/:id/episodes?specials=1`, `schedule/full` to canonical models. Handles `airstamp` passthrough, 429 backoff, `User-Agent: TVTrack/0.1`, 60m/24h cache respect.
- **HttpClient wrapper:** single place for fetch, retries, rate-limit handling. Injected into adapters.
- **Future TMDBArtworkAdapter implements ArtworkProvider only** — never used for air dates. Requires `TMDB_API_KEY`, disabled by default.

### 3.5 Sync Service (`server/sync/`)
- **Responsibility:** only writer that calls `ShowProvider` and upserts into stores. Triggered manually: `refreshShow(showId)`, `refreshAll()`. Records `sync_meta { showId, lastSyncedAt }`.
- **Rules:** upsert by TVMaze ID, never overwrite `watched` flags; fetch server-side, filter to subscribed IDs before storing; never send multi-MB `schedule/full` blob to client.
- **Depends on:** `ShowProvider` + `ShowStore`/`EpisodeStore`. Does not serve reads.

### 3.6 Store / Persistence (`server/store/`)
Interface-first so SQLite can be swapped for JSON/files later:

```ts
interface ShowStore { upsertShow(s: Show): void; getShow(id): Show; listSubscribed(status?): Show[]; }
interface EpisodeStore { upsertMany(eps: Episode[]): void; listFutureSubscribed(now, limit, offset): Episode[]; listBySeason(seasonId): Episode[]; }
interface WatchStore { isWatched(epId): bool; setWatched(...); clearForShow(showId); }
```

- **SQLite impl** (`server/store/sqlite/`): single file `tvtrack.db`. Schema:
  - `shows(tvmaze_id PK, name, network, status, externals_json, poster_url, schedule_days_json, last_synced_at)`
  - `subscriptions(show_id PK, status, added_at)` — or folded into `shows.status`; separate table preferred for clean service boundary
  - `seasons(id PK, show_id FK, season_no, episode_order, premiere_date)`
  - `episodes(tvmaze_id PK, show_id FK, season_id FK, season_no, number, title, airdate, airtime, airstamp, runtime, image_url)`
  - `watched(episode_id PK, watched BOOL)` — sparse or full rows; preserve across syncs
  - `sync_meta(show_id PK, last_synced_at)`
- Migrations versioned, one module owns schema.

### 3.7 Import/Export Service (`server/io/`)
- `exportJson() -> { shows, subscriptions, watched }` with TVMaze IDs; `importJson(blob)` upserts via stores. No CSV parsing in v1. Independent of providers.

### 3.8 Cross-cutting: Time & Config (`server/platform/`)
- **TimeService:** `now()`, `toCentral(airstamp)`, `formatCountdown(airstamp)`. Fixed zone `America/Chicago`. Clock injectable for deterministic tests.
- **Config:** `PORT`, `DB_PATH`, `TZ=America/Chicago`, optional `TMDB_API_KEY` (unused v1). Composition root (`server/main`) wires concrete adapters into services — only place that knows about TVMaze + SQLite.

## 4. Data Flows
- **Subscribe:** Client `GET /api/search?q=` → API → Sync (provider search, no DB write) → Client `POST /api/subscriptions` → SubscriptionService → Sync fetches detail → Store upsert → Client re-fetches library.
- **Upcoming:** Client `GET /api/upcoming?limit=30&offset=0` → ScheduleService reads `EpisodeStore.listFutureSubscribed(now)` → TimeService formats Central + countdown.
- **Toggle watched:** Client `PATCH /api/episodes/:id` → WatchService → WatchStore. Progress recomputed on read, not stored.
- **Refresh:** Client `POST /api/refresh/:showId` → SyncService → TVMazeAdapter → Store upsert (watched preserved).

## 5. API Contract (v1)
- `GET /api/search?q=`
- `GET /api/subscriptions?status=` / `POST /api/subscriptions {tvmazeId}` / `PATCH /api/subscriptions/:id {status}` / `DELETE /api/subscriptions/:id`
- `GET /api/upcoming?limit&offset` → `{ items: [{showId, showName, seasonNo, epNo, title, airstamp, centralDisplay, countdown}], nextOffset }`
- `GET /api/shows/:id?include=seasons,episodes,progress`
- `PATCH /api/episodes/:id {watched}` / `POST /api/seasons/:id/watched {watched}` / `POST /api/episodes/:id/watch-up-to-here`
- `POST /api/refresh/:showId` / `POST /api/refresh-all`
- `GET /api/export` / `POST /api/import`

All DTOs use canonical fields (`seasonNo`, `number`, `airstamp`, `watched`), never raw TVMaze shapes — keeps provider swap painless.

## 6. Modularity Rules
- Dependency direction: `api -> domain -> store/provider interfaces`; `sqlite` and `tvmaze` depend inward on interfaces, never on each other.
- No module imports a sibling's internals; shared types live in `server/model/` (Show, Season, Episode, Subscription).
- Each component builds/tests in isolation with fakes (`FakeShowProvider`, in-memory stores).
- Composition root only place with `new TVMazeAdapter`, `new SqliteStore`.

## 7. Suggested Repo Layout (Node 24 + Vue monorepo)
```
tvtrack/
  REQUIREMENTS.md
  DESIGN.md
  package.json         # workspaces: client, server, packages/model
  packages/model/      # shared TS types + Zod schemas (only cross-import allowed)
  client/              # Vue 3 + Vite + Vue Router (views only, no business logic)
    src/views/         # Library, Upcoming, ShowDetail
    src/api/           # typed fetch client for /api/*
  server/              # Fastify + TS, serves client/dist in prod
    src/main.ts        # composition root, config
    src/api/           # handlers
    src/domain/        # subscription, schedule, watch (pure)
    src/providers/     # ShowProvider iface + tvmaze/ + artwork-stub/
    src/sync/          # refresh jobs
    src/store/         # interfaces + sqlite/ (node:sqlite)
    src/io/            # export/import
    src/platform/      # time (America/Chicago), config, http client
```

## 8. Build Phases
1. **Model + Store + Time:** types, SQLite schema, seed-less CRUD.
2. **Providers:** `ShowProvider` iface + TVMazeAdapter (search/detail) with rate-limit handling.
3. **Domain:** Subscription/Watch/Schedule logic with unit tests (fakes).
4. **API + Sync wiring:** endpoints + manual refresh, `lastSyncedAt`.
5. **Client:** Vue library / upcoming + More / show-season-episode views.
6. **IO stub:** export/import round-trip test.

## 9. Env Note
- Dev machine has Node 18.17.1 + missing macOS CLT (`xcrun` invalid). Node 24 needed for `node:sqlite` + Vite 6.
- `node:sqlite` chosen deliberately: zero native build, so no CLT required. Avoid `better-sqlite3` until CLT fixed.
- Upgrade path: install Node 24 via standalone tarball/fnm (not brew, brew also needs CLT). Then `node --version` should read v24.x before scaffolding.
