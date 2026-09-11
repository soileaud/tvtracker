import type { ShowStatus } from "@tvtrack/model";
import type { ShowDetail } from "../providers/index.js";
import type { Stores } from "../store/sqlite/index.js";

// Subscription use-cases (REQUIREMENTS FR-1). Pure orchestration over stores;
// fetching the ShowDetail is the caller's (sync service's) job.

export function subscribe(
  stores: Stores,
  detail: ShowDetail,
  status: ShowStatus = "Watching",
  nowIso: string = new Date().toISOString(),
): void {
  stores.shows.upsertShow(detail.show);
  stores.seasons.upsertMany(detail.seasons);
  stores.episodes.upsertMany(detail.episodes);
  stores.subscriptions.add({
    showId: detail.show.tvmazeId,
    status,
    addedAt: nowIso,
    rating: null,
    note: null,
  });
}

export function unsubscribe(stores: Stores, showId: number): void {
  stores.subscriptions.remove(showId);
}

export function setSubscriptionStatus(
  stores: Stores,
  showId: number,
  status: ShowStatus,
): void {
  if (!stores.subscriptions.get(showId)) {
    throw new Error(`not subscribed: ${showId}`);
  }
  stores.subscriptions.setStatus(showId, status);
}
