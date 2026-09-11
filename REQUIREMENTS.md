# TVTrack - Requirements Document

## 1. Vision
Personal, local-only recreation of core TV Time features. No cloud, no social, no accounts. Single shared state hosted on a home server and accessed from desktop and mobile browsers on the local network.

High-level goals:
1. Subscribe to shows
2. See upcoming show schedules sorted by soonest
3. Track watched episodes for subscribed shows by season

## 2. Scope

### In scope (v1)
- Local web app, mobile-friendly responsive UI
- Show search and subscription management with statuses
- Upcoming agenda sorted by soonest (future airings only)
- Season / episode watched tracking with bulk actions and progress
- TVMaze-backed data with local cache
- Stub import / export (JSON dump)

### Non-goals (explicitly out)
- Notifications / reminders (browser, email, webhook) - No
- Discovery / trending / recommendations / similar shows - No
- Stats dashboard (time watched, streaks, episodes left analytics) - No
- Ratings, notes, rewatch tracking, watched dates - No, boolean watched only
- Spoiler protection (hide overviews/thumbnails) - No
- Offline-first PWA - No. Server expects internet for search/refresh; cached data remains viewable if API is down, but offline operation is not guaranteed.
- Multi-user accounts, auth, profiles - No. Single user.

## 3. Users & Platform

- **User:** single user, no login.
- **Deployment:** one server process (e.g. `http://server:port` on LAN), multiple concurrent browser clients (desktop + mobile) sharing the same backend state. Last-write-wins acceptable for v1, no conflict resolution.
- **Client:** modern browser, responsive mobile-friendly layout. No native app.
- **Timezone:** fixed display in Central US - `America/Chicago`. Show network air time converted to Central plus relative countdown (e.g. `in 2d 4h`).

## 4. Data Source Decision - FR-0: TVMaze Primary

**Decision: TVMaze is primary for v1. TMDB reserved as optional future artwork enrichment only.**

Rationale:
- TVMaze is keyless, CORS-enabled, TV-purpose-built. No secret management for a local app.
- TVMaze provides `airdate + airtime + airstamp` (ISO8601 with offset) per episode. Required for correct Central-time conversion and soonest-first sorting. TMDB episode only provides `air_date` (date-only), insufficient.
- TVMaze provides `GET /schedule?country=US&date=`, `GET /schedule/web`, and `GET /schedule/full` (all future known episodes). This maps 1:1 to the upcoming agenda requirement. TMDB only provides show-level `/tv/on_the_air` (next 7 days), requiring N+1 per-show fetches and incomplete beyond 7 days.
- TVMaze provides `GET /shows/:id/episodes?specials=1`, `/shows/:id/seasons`, `episodebynumber`, `episodesbydate` (for daily talk shows). Specials flag covers S00 requirement.
- TVMaze provides `GET /updates/shows` for incremental refresh and `_links.previousepisode / nextepisode` for quick next-airing.
- TMDB strength is posters/backdrops. Leave a `PosterProvider` interface stub to allow optional `TMDB_API_KEY`-based artwork fallback later.

TVMaze specifics to use:
- Base: `https://api.tvmaze.com`
- Search: `GET /search/shows?q=` (fuzzy), `GET /singlesearch/shows?q=&embed=episodes` for disambiguation
- Show: `GET /shows/:id`, `GET /shows/:id/seasons`, `GET /shows/:id/episodes?specials=1`
- Schedule: `GET /schedule/full` (cached 24h, several MB - filter locally to subscribed IDs), plus per-date `GET /schedule?country=US&date=YYYY-MM-DD` for refresh
- Updates: `GET /updates/shows`
- Rate limit: 20 req / 10s per IP, handle 429 with backoff. Edge cache 60min.
- Terms: CC BY-SA, attribute tvmaze.com. Images at `static.tvmaze.com` may be hotlinked but should be cached locally; image URLs immutable so cache indefinitely.
- Set descriptive `User-Agent` (e.g. `TVTrack/0.1 local-personal`).

## 5. Architecture & Storage

- **Backend:** TBD (recommend Python + SQLite or Node + SQLite - simplest for single-file backup).
- **Storage:** SQLite single file (no preference stated, SQLite chosen for portability, single-file backup, concurrent LAN reads). Tables approximately: `shows`, `seasons`, `episodes`, `subscriptions`, `watched`, `sync_meta`.
- **Caching strategy:**
  - On subscribe: fetch and persist show + seasons + episodes (including specials).
  - On refresh (per-show or refresh-all button): re-fetch episodes/seasons, upsert by TVMaze ID, preserve local `watched` flags.
  - Upcoming view derived locally from cache: `WHERE airstamp > now() AND show_id IN subscriptions ORDER BY airstamp ASC`, paginated.
  - Store raw `airstamp`, `airdate`, `airtime`, `runtime`, `season`, `number`, `type`, `image_urls`.
- **Backup:** SQLite file copy + JSON export stub sufficient for v1.

## 6. Functional Requirements

### FR-1: Subscribe to Shows
- **FR-1.1 Search & Add:** search by name via TVMaze, show result list with year/network/poster/status to disambiguate, Add to library. Store TVMaze show ID as canonical key plus externals (`tvdb`, `imdb`) if available for future import mapping.
- **FR-1.2 Statuses:** per-subscription status: `Watching / Backlog / Paused / Ended`. Filter library by status. Default on add: `Watching`.
- **FR-1.3 Unsubscribe:** remove show with confirm dialog: `Remove show and delete watched history for this show? [Remove / Cancel]`.
- **FR-1.4 Ended / Cancelled:** no separate archive view. Ended shows naturally drop off upcoming list since they have no future `airstamp`. They remain in library filterable by `Ended` status.

### FR-2: Upcoming Schedule (sorted by soonest)
- **FR-2.1 Agenda list only:** rows of `Show name - S02E03 - "Episode title" - airs Central datetime - in Xd Xh`. Sorted ascending by `airstamp`.
- **FR-2.2 Future only:** exclude already-aired episodes even if unwatched. Unwatched backlog lives in library/show view, not here.
- **FR-2.3 Scope:** all future known airings for subscribed shows. Initial page e.g. 30 items, `More` button lazy-loads next page (server-side LIMIT/OFFSET on cached `airstamp` ordering).
- **FR-2.4 No calendar week/month view in v1.** No far-future filter in v1.
- **FR-2.5 Row action:** click navigates to show -> season -> episode anchor.

### FR-3: Track Watched Episodes by Season
- **FR-3.1 Navigation:** Library -> Show detail -> Season selector (including S00 Specials) -> Episode list showing `E#, title, air date (Central), still if available`.
- **FR-3.2 Watched toggle:** per-episode boolean checkbox. No date, no notes, no rating.
- **FR-3.3 Bulk actions (required):**
  - `Mark season watched`
  - `Mark season unwatched`
  - `Mark up to here` (marks this episode and all prior episodes in season/show order as watched)
- **FR-3.4 Progress:** per-season progress bar `7/10` and per-show progress bar plus `Next unwatched` button that scrolls to / opens first `watched=false AND airdate <= today` or first unaired? Definition: first episode in air order with `watched=false` (regardless of air date, since future items exist in cache).
- **FR-3.5 Specials:** include S00 specials inline in season list and progress counts. No special handling.
- **FR-3.6 Spoilers:** no hiding of overviews/thumbnails.

### FR-4: Import / Export (stub only)
- **FR-4.1 Export JSON:** `GET /api/export` dumps `{ shows, subscriptions, watched }` with TVMaze IDs. Button in settings.
- **FR-4.2 Import JSON:** `POST /api/import` accepts same format, upserts. No full TV Time CSV parser in v1, but preserve externals to enable it later.
- Acceptance: export -> wipe DB -> import restores subscriptions + watched flags.

## 7. UX Requirements
- Mobile-first responsive: upcoming list readable on phone, large tap targets for watched checkboxes.
- Library search input with debounce, poster grid.
- Show page: header (poster, network, schedule days/time, status dropdown), season tabs, episode rows.
- Manual `Refresh` per show + `Refresh all` button. Show `last synced` timestamp.
- Empty states: no subscriptions, no upcoming, season fully watched.

## 8. API Sketch (backend, to be finalized in design)
- `GET /api/search?q=` -> proxy TVMaze search
- `POST /api/subscriptions { tvmazeId }`
- `GET /api/subscriptions?status=`
- `DELETE /api/subscriptions/:id`
- `PATCH /api/subscriptions/:id { status }`
- `GET /api/upcoming?limit=30&offset=0` -> sorted future from cache
- `GET /api/shows/:id?include=seasons,episodes,progress`
- `PATCH /api/episodes/:id { watched: bool }`
- `POST /api/seasons/:id/watched { watched: bool }`
- `POST /api/episodes/:id/watch-up-to-here`
- `POST /api/refresh/:showId`, `POST /api/refresh-all`
- `GET /api/export`, `POST /api/import`

## 9. Acceptance Criteria
1. Can search, add with status, change status, remove a show (with history wipe).
2. Upcoming page shows only future episodes for subscribed shows, sorted soonest-first, displayed in America/Chicago with countdown, paginated via More.
3. Can toggle episodes watched (boolean), bulk-mark season / up-to-here, progress bars update, Next unwatched jumps correctly. Specials counted.
4. Restart server preserves data (SQLite persistence).
5. Accessible from phone browser on LAN, shared state visible from two clients.
6. Export / import round-trips subscriptions + watched.
7. No API key required for default operation (TVMaze only).

## 10. Open Decisions for Design Phase
- Exact backend stack (recommend SQLite + minimal API server).
- TVMaze show refresh cadence: manual only vs nightly cron.
- Handling of `GET /schedule/full` size (several MB): fetch server-side, filter, never send full blob to client.
- Poster caching: proxy + local disk cache vs hotlink.
- Status list final: `Watching / Backlog / Paused / Ended` - confirmed?
