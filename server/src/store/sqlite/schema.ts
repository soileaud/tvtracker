export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shows (
  tvmaze_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  network TEXT,
  poster_url TEXT,
  schedule_days TEXT NOT NULL DEFAULT '[]',
  schedule_time TEXT,
  show_status TEXT,
  externals_tvdb INTEGER,
  externals_imdb TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS subscriptions (
  show_id INTEGER PRIMARY KEY REFERENCES shows(tvmaze_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Watching',
  added_at TEXT NOT NULL,
  rating INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows(tvmaze_id) ON DELETE CASCADE,
  season_no INTEGER NOT NULL,
  episode_order INTEGER,
  premiere_date TEXT
);

CREATE TABLE IF NOT EXISTS episodes (
  tvmaze_id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows(tvmaze_id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  season_no INTEGER NOT NULL,
  number INTEGER,
  title TEXT NOT NULL,
  airdate TEXT,
  airtime TEXT,
  airstamp TEXT,
  runtime INTEGER,
  image_url TEXT,
  type TEXT NOT NULL DEFAULT 'regular',
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_episodes_future
  ON episodes(show_id, airstamp);

CREATE TABLE IF NOT EXISTS watched (
  episode_id INTEGER PRIMARY KEY REFERENCES episodes(tvmaze_id) ON DELETE CASCADE,
  watched INTEGER NOT NULL DEFAULT 1,
  -- NULL = bulk season backfill (excluded from History); a timestamp means
  -- the episode was individually marked (or gap-filled) on that date.
  watched_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_meta (
  show_id INTEGER PRIMARY KEY REFERENCES shows(tvmaze_id) ON DELETE CASCADE,
  last_synced_at TEXT NOT NULL
);
`;

/** Idempotent migrations for pre-existing DB files (runs after CREATEs). */
export const MIGRATIONS = [
  `ALTER TABLE episodes ADD COLUMN summary TEXT`,
  `ALTER TABLE shows ADD COLUMN show_status TEXT`,
  `ALTER TABLE subscriptions ADD COLUMN rating INTEGER`,
  `ALTER TABLE subscriptions ADD COLUMN note TEXT`,
  `ALTER TABLE watched ADD COLUMN watched_at TEXT`,
];

export function migrate(db: { exec: (sql: string) => void }): void {
  for (const sql of MIGRATIONS) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists — sqlite errors on duplicate ADD COLUMN.
    }
  }
}
