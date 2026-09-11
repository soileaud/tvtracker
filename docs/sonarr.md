# Sonarr integration (optional)

TVTrack can show per-episode download state from Sonarr: a `⬇ downloading`
badge while grabbing, `missing file` for aired-but-not-downloaded monitored
episodes, and a `12/40 files` summary per show. Read-only — TVTrack never
tells Sonarr to download anything.

## Prerequisites

- Sonarr v3 or v4, reachable from the machine running TVTrack. It does **not**
  need to be on this dev machine — configure it where you deploy.
- Shows match by **TVDB id** (`externals.tvdb` from TVMaze). Shows without a
  TVDB id report `matched: false` and the download section stays hidden.

## Setup

1. In Sonarr: **Settings → General → Security → API Key** — copy it.
   (Sonarr listens on port `8989` by default.)
2. Set env vars where TVTrack runs:
   ```
   SONARR_URL=http://localhost:8989
   SONARR_API_KEY=<paste key>
   ```
3. Restart the server. Startup logs `sonarr integration on` when picked up.

Verify with curl (replace `169` with a subscribed show id):

```
curl http://localhost:3001/api/sonarr/status/169
# {"configured":true,"matched":true,"monitored":true,"total":63,
#  "withFiles":61,"downloadingCount":1,...}
```

`{"configured":false}` means the env vars are missing — the UI hides all
Sonarr elements in that case, and everything else works normally.

## How matching works

1. TVTrack looks up the Sonarr series whose `tvdbId` equals the show's TVDB id.
2. `/api/v3/episode?seriesId=` gives `monitored` / `hasFile` per
   season+episode; `/api/v3/queue` marks what's actively downloading
   (`sizeleft > 0`).
3. Episodes already on disk show no badge (no noise); only `downloading`
   and aired-but-missing monitored episodes are flagged.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `configured: false` | `SONARR_URL`/`SONARR_API_KEY` unset or blank. Restart after setting. |
| `matched: false` + `reason: no-tvdb-id` | TVMaze has no TVDB id for the show. Nothing to do. |
| `matched: false` (no reason) | Show isn't added in Sonarr. Add it there first. |
| `sonarr unreachable: …` | Wrong URL/port, Sonarr down, or bad API key. `curl $SONARR_URL/api/v3/series -H "X-Api-Key: $SONARR_API_KEY"` should return JSON. |
| Stale badges | File state is fetched live on each show-page visit — just revisit. |
