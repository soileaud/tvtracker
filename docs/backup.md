# Backup / restore

Two mechanisms — use either. File copy is simplest and fully faithful;
JSON export/import is portable and safe to re-run.

## Where the data lives

- SQLite file at `DB_PATH` (default `./data/tvtrack.db`, relative to where
  the server process starts — normally the repo root). Created on first run
  (`server/src/main.ts` runs schema + migrations on open).
- Override per environment: `DB_PATH=/path/to/tvtrack.db npm run start -w @tvtrack/server`.

## Option A — file copy (full fidelity)

Best for machine migration / disaster recovery. Stop the server first so
SQLite isn't mid-write.

```sh
# backup
cp ./data/tvtrack.db "./data/tvtrack.db.bak-$(date +%F)"

# restore (server stopped)
cp "./data/tvtrack.db.bak-2026-09-11" ./data/tvtrack.db
npm run start -w @tvtrack/server
```

Notes:

- Restoring to a fresh machine: install (`npm install`), copy the `.db` file
  into `./data/`, start the server.
- If the `sqlite3` CLI is available, a live backup without stopping works too:
  `sqlite3 ./data/tvtrack.db ".backup './data/tvtrack.db.bak'"`.
- Keep file permissions readable by the server user.

## Option B — JSON export / import (portable)

Versioned dump served by the API (`server/src/io/index.ts`,
`GET /api/export` / `POST /api/import` in `server/src/api/index.ts`).

```sh
# export (server running)
curl -s http://localhost:3001/api/export -o "tvtrack-backup-$(date +%F).json"

# import into any running server
curl -s -X POST http://localhost:3001/api/import \
  -H 'Content-Type: application/json' \
  --data @"tvtrack-backup-2026-09-11.json"
# {"shows":12}
```

What the blob holds (`version: 1`):

| Key | Contents |
|---|---|
| `shows` | Per-show TVMaze snapshot (ids, name, network, poster, schedule, externals, `lastSyncedAt`) |
| `subscriptions` | `showId`, `status`, `addedAt`, `rating`, `note` |
| `seasons` / `episodes` | Cached TVMaze catalog rows |
| `watched` | `{ episodeId, watchedAt }` per watched episode |
| `exportedAt` | ISO timestamp of the dump |

Semantics (matches the round-trip test in `server/test/api.test.ts`):

- **Upsert / idempotent.** Shows, seasons, episodes overwrite on conflict;
  subscriptions overwrite; watched rows are `INSERT OR IGNORE`, so the
  first-watch date wins and re-importing never moves History dates.
- **Additive — it never deletes.** Shows already in the target DB but absent
  from the blob are left alone. For an exact clone, start from an empty DB:
  stop the server, `rm ./data/tvtrack.db` (or point `DB_PATH` at a fresh
  path), restart so the schema is recreated, then `POST /api/import`.
- **Backward compatible.** Pre-rating exports (no `rating`/`note`/
  `showStatus`) still import (default `null`); v0 bare-number `watched`
  entries import as `watched_at = NULL` backfills — counted in progress but
  excluded from History, same as bulk season marks.
- **Errors.** Anything that isn't a version-1 blob returns
  `400 {"error":"invalid import blob (expected version-1 export JSON)"}`.

## Verify

```sh
curl -s http://localhost:3001/api/stats
# {"showsTotal":…,"episodesBehind":…,…}
```

Spot-check the Library UI, plus one show's progress (`GET /api/shows/:id`
→ `progress`, `rating`, `note`). For JSON restores, diffing a fresh
`GET /api/export` against the imported file (ignoring `exportedAt`) should
show only ordering/whitespace noise.
