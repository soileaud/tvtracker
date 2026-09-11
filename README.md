# TVTrack

Personal, local-only TV tracker (TV Time clone). Single user, no accounts.
Subscribe to shows, see upcoming airings soonest-first, track watched episodes by season.
Data from TVMaze, cached locally in SQLite. See `REQUIREMENTS.md` and `DESIGN.md`.

## Prereqs

- Node 24 LTS (uses built-in `node:sqlite`; Node 18 will not work)
  ```
  nvm use 24   # default is already set to 24 on this machine
  ```

## Install

```
npm install
```

## Run (dev)

Two processes — API on :3001, client on :5173 (proxies `/api` to the server):

```
npm run server   # dev API on :3001 (or: npm run dev -w @tvtrack/server)
npm run client   # dev UI on :5173, proxies /api (or: npm run dev -w @tvtrack/client)
```

Open http://localhost:5173. The server creates `./data/tvtrack.db` on first run.

## Run (prod, single process)

```
npm run build            # model -> server -> client
npm run start -w @tvtrack/server
```

The API serves the Vue build itself on `PORT` (default 3001), reachable on your LAN.

## Env

| Var              | Default             | Purpose                                              |
|------------------|---------------------|------------------------------------------------------|
| `PORT`           | `3001`              | Server port                                          |
| `DB_PATH`        | `./data/tvtrack.db` | SQLite file (back this up)                           |
| `TZ`             | system              | Display is fixed to `America/Chicago` in-app         |
| `AUTO_REFRESH`   | `true`              | Nightly refresh of all subscribed shows (`false` off)|
| `REFRESH_HOUR`   | `3`                 | Central hour for the nightly refresh                 |
| `SONARR_URL`     | unset (off)         | e.g. `http://localhost:8989` — see `docs/sonarr.md`  |
| `SONARR_API_KEY` | unset (off)         | Sonarr → Settings → General → API Key                |

## Optional integrations

- **Sonarr download state** (per-episode ⬇/missing badges): `docs/sonarr.md`
- **Install on phone home screen + offline shell (PWA)**: `docs/pwa.md`

## Test

```
npm run test -w @tvtrack/server
```

## Backup / restore

- File copy of `data/tvtrack.db` (stop server first), or
- `GET /api/export` → save JSON; `POST /api/import` to restore.

Full commands, blob format, and restore semantics: `docs/backup.md`.

## Layout

```
packages/model/  shared types + Zod DTO schemas
server/src/
  main.ts        composition root (only place that news up TVMaze + SQLite)
  api/           Fastify handlers (thin, one service call each)
  domain/        subscription / schedule / watch (pure, tested)
  providers/     ShowProvider interface + tvmaze/ adapter
  sync/          manual refresh jobs + nightly scheduler (sole provider writer)
  store/         store interfaces + sqlite/ implementation
  sonarr/        optional Sonarr client (null unless env set)
  io/            export/import stub
  platform/      Central-time helpers
client/src/
  views/         Upcoming / Library / ShowDetail
  api/           typed fetch client
```
