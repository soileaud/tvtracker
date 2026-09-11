import type { ShowStatus } from "@tvtrack/model";
import type { ShowProvider } from "../providers/index.js";
import type { Stores } from "../store/sqlite/index.js";

// Sync service (DESIGN §3.5): the ONLY writer that calls ShowProvider.
// Triggered manually via API. Upserts never touch the watched table, so
// re-fetching preserves local watched flags.

export class SyncService {
  constructor(
    private stores: Stores,
    private provider: ShowProvider,
  ) {}

  private recordSync(showId: number): void {
    this.stores.db
      .prepare(
        `INSERT INTO sync_meta (show_id, last_synced_at) VALUES (?, ?)
         ON CONFLICT(show_id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
      )
      .run(showId, new Date().toISOString());
  }

  async refreshShow(tvmazeId: number): Promise<void> {
    const detail = await this.provider.getShowDetail(tvmazeId);
    this.stores.shows.upsertShow(detail.show);
    this.stores.seasons.upsertMany(detail.seasons);
    this.stores.episodes.upsertMany(detail.episodes);
    this.recordSync(tvmazeId);
  }

  /** Fetch detail + subscribe (or update status if already subscribed). */
  async subscribe(tvmazeId: number, status: ShowStatus = "Watching"): Promise<void> {
    await this.refreshShow(tvmazeId);
    const existing = this.stores.subscriptions.get(tvmazeId);
    if (existing) {
      if (existing.status !== status) {
        this.stores.subscriptions.setStatus(tvmazeId, status);
      }
    } else {
      this.stores.subscriptions.add({
        showId: tvmazeId,
        status,
        addedAt: new Date().toISOString(),
        rating: null,
        note: null,
      });
    }
  }

  async refreshAll(): Promise<{ refreshed: number }> {
    const shows = this.stores.shows.listSubscribed();
    let refreshed = 0;
    for (const s of shows) {
      await this.refreshShow(s.tvmazeId);
      refreshed++;
    }
    return { refreshed };
  }
}
