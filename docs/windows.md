# TVTrack on Windows — auto-start + Dropbox backups

Native Windows, no WSL needed. Two scheduled tasks:

| Task | When | What |
|---|---|---|
| Auto-start server | At logon / boot | `npm run start -w @tvtrack/server` (prod, serves API + Vue build on `:3001`) |
| Dropbox backup | Nightly 4:00 AM | `GET /api/export` → `~/Dropbox/TVTrack/tvtrack-backup-YYYY-MM-DD.json` (keep 30) |

4am is deliberate — after the 3am `REFRESH_HOUR` auto-refresh, so the backup includes fresh airings.

## Prereqs

1. Node 24 LTS (`winget install OpenJS.NodeJS.LTS`), on PATH for all users.
2. One-time build from the repo root:
   ```powershell
   npm install
   npm run build  # model -> server -> client
   ```
3. Confirm it runs in the foreground first:
   ```powershell
   npm run start -w @tvtrack/server
   # open http://localhost:3001 -> redirects to /library
   ```
   Press `Ctrl+C` to stop before continuing.

## Part A — auto-start the server

### A1. Create the start script

Save as `scripts\start-server.ps1` in the repo (create `scripts\` first):

```powershell
$ErrorActionPreference = "Stop"
Set-Location "C:\path\to\tvtracker"
$env:PORT = "3001"
# $env:DB_PATH = "C:\path\to\tvtracker\server\data\tvtrack.db"  # optional; this is the default
# $env:SONARR_URL = "http://localhost:8989"                        # optional; see docs/sonarr.md
# $env:SONARR_API_KEY = "..."                                      # optional
npm run start -w @tvtrack/server
```

> Use a fixed `C:\path\to\...`, not a mapped drive. If Node is per-user,
> use its full path (e.g. `C:\Program Files\nodejs\npm.cmd`) instead of bare `npm`.

### A2. Schedule it

GUI (Start → Task Scheduler → **Create Task**):

1. **General:** name `TVTrack server`, ✅ `Run whether user is logged on or not`,
   ✅ `Do not store password` only if the DB/data dirs are local (uncheck for network paths).
2. **Triggers → New:** `At log on` (any user, or yours) — plus add a second
   trigger `At startup` with 1-minute delay if you want it before logon.
3. **Actions → New → Start a program:**
   - Program: `powershell.exe`
   - Arguments: `-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\tvtracker\scripts\start-server.ps1"`
   - Start in: `C:\path\to\tvtracker`
4. **Settings:** ✅ `If the task fails, restart every:` 1 minute, attempts 3.
   ✅ `Run task as soon as possible after a scheduled start is missed`.
5. OK → enter your Windows password if prompted.

CLI equivalent (admin PowerShell — adjust paths):

```powershell
schtasks /create /tn "TVTrack server" `
  /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\path\to\tvtracker\scripts\start-server.ps1'" `
  /sc onlogon /f
```

### A3. Verify

```powershell
Start-ScheduledTask -TaskName "TVTrack server"
Start-Sleep 5
Invoke-RestMethod http://localhost:3001/api/health   # @{ok=True}
Invoke-RestMethod http://localhost:3001/api/stats
```

- Phone on same Wi-Fi: `http://<server-lan-ip>:3001` (allow the firewall
  prompt for private networks; see `docs/pwa.md` for Add to Home Screen).
- After `git pull`: `npm install; npm run build`, then
  `Stop-ScheduledTask` / `Start-ScheduledTask -TaskName "TVTrack server"`.

## Part B — nightly Dropbox backup (versioned JSON export)

Do **not** point Dropbox at the live `tvtrack.db` — a cloud sync grabbing
SQLite mid-transaction can corrupt the copy. Sync *backups* instead
(`docs/backup.md` Option B: idempotent, server stays running).

### B1. Create the folder + test once

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Dropbox\TVTrack"
Invoke-RestMethod http://localhost:3001/api/export `
  -OutFile "$env:USERPROFILE\Dropbox\TVTrack\tvtrack-backup-$(Get-Date -Format yyyy-MM-dd).json"
Get-ChildItem "$env:USERPROFILE\Dropbox\TVTrack"
```

Expect `tvtrack-backup-YYYY-MM-DD.json` starting with `{"version":1,...}`.

### B2. Save the backup script

Save as `scripts\backup-to-dropbox.ps1`:

```powershell
$ErrorActionPreference = "Stop"
$destDir = "$env:USERPROFILE\Dropbox\TVTrack"
New-Item -ItemType Directory -Force $destDir | Out-Null
$date = Get-Date -Format yyyy-MM-dd
$dest = "$destDir\tvtrack-backup-$date.json"
try {
  Invoke-RestMethod http://localhost:3001/api/export -TimeoutSec 60 -OutFile $dest
} catch {
  Write-Error "TVTrack export failed (is the server running?): $_"
  exit 1
}
# keep last 30 days
Get-ChildItem "$destDir\tvtrack-backup-*.json" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 30 |
  Remove-Item -Force
```

Test it:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\path\to\tvtracker\scripts\backup-to-dropbox.ps1"
```

### B3. Schedule it nightly

GUI: **Create Task** named `TVTrack Dropbox backup` → **Triggers:** Daily
`4:00 AM` → **Actions:**

- Program: `powershell.exe`
- Arguments: `-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\tvtracker\scripts\backup-to-dropbox.ps1"`

**Conditions:** uncheck `Start the task only if the computer is on AC power`
for a desktop. **Settings:** ✅ `Run task as soon as possible after a
scheduled start is missed`.

CLI:

```powershell
schtasks /create /tn "TVTrack Dropbox backup" `
  /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\path\to\tvtracker\scripts\backup-to-dropbox.ps1'" `
  /sc daily /st 04:00 /f
```

### B4. Verify + restore

- Right-click the task → **Run**, confirm today's file appears and syncs to dropbox.com.
- `LastTaskResult: 0` in Task Scheduler history.
- Restore into any running server:
  ```powershell
  Invoke-RestMethod -Method Post http://localhost:3001/api/import `
    -ContentType "application/json" `
    -InFile "$env:USERPROFILE\Dropbox\TVTrack\tvtrack-backup-YYYY-MM-DD.json"
  # {"shows":12}
  ```
  Then spot-check `GET /api/stats` + the Library UI. Full semantics:
  `docs/backup.md`.
