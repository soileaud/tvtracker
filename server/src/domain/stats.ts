import type { StatsSummary } from "@tvtrack/model";
import type { Stores } from "../store/sqlite/index.js";

// Stats-lite (episodes/hours behind). Single aggregate query over aired,
// unwatched episodes of subscribed shows.
//
// Only Watching + Ended shows count: Backlog ("haven't started") and Paused
// ("shelved") are aspirational, not behind. Ended counts — a finished show
// you're working through is still completable backlog in the real sense.

export function getStats(stores: Stores, nowIso: string): StatsSummary {
  const behind = stores.db
    .prepare(
      `SELECT COUNT(*) AS episodes,
              COALESCE(SUM(e.runtime), 0) AS minutes,
              COUNT(DISTINCT e.show_id) AS shows
       FROM episodes e
       JOIN subscriptions s ON s.show_id = e.show_id
       LEFT JOIN watched w ON w.episode_id = e.tvmaze_id
       WHERE w.episode_id IS NULL
         AND e.airstamp IS NOT NULL AND e.airstamp <= ?
         AND s.status NOT IN ('Paused', 'Backlog')`,
    )
    .get(nowIso) as unknown as { episodes: number; minutes: number; shows: number };
  const total = stores.db
    .prepare(`SELECT COUNT(*) AS n FROM subscriptions`)
    .get() as unknown as { n: number };
  return {
    showsTotal: total.n,
    showsBehind: behind.shows,
    episodesBehind: behind.episodes,
    minutesBehind: behind.minutes,
  };
}
