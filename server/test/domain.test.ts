import { describe, expect, it } from "vitest";
import { openStores } from "../src/store/sqlite/index.js";
import {
  setSubscriptionStatus,
  subscribe,
  unsubscribe,
} from "../src/domain/subscription.js";
import {
  getUpcoming,
} from "../src/domain/schedule.js";
import {
  markUpToHere,
  nextUnwatched,
  seasonProgress,
  setSeasonWatched,
  showProgress,
} from "../src/domain/watch.js";
import type { Episode, Show } from "@tvtrack/model";

const show: Show = {
  tvmazeId: 1,
  name: "Alpha",
  network: "HBO",
  posterUrl: null,
  scheduleDays: ["Sunday"],
  scheduleTime: "21:00",
  showStatus: "Running",
  externals: { tvdb: null, imdb: null },
  lastSyncedAt: null,
};

function ep(num: number, airstamp: string, seasonNo = 1): Episode {
  return {
    tvmazeId: 1000 + num,
    showId: 1,
    seasonId: `1:S${seasonNo}`,
    seasonNo,
    number: num,
    title: `E${num}`,
    airdate: airstamp.slice(0, 10),
    airtime: "21:00",
    airstamp,
    runtime: 60,
    imageUrl: null,
    type: "regular",
    summary: `Overview ${num}`,
  };
}

function seeded() {
  const stores = openStores(":memory:");
  subscribe(
    stores,
    {
      show,
      seasons: [{ id: "1:S1", showId: 1, seasonNo: 1, episodeOrder: 3, premiereDate: null }],
      episodes: [
        ep(1, "2026-09-01T20:00:00-05:00"),
        ep(2, "2026-09-12T20:00:00-05:00"),
        ep(3, "2026-09-19T20:00:00-05:00"),
      ],
    },
    "Watching",
    "2026-09-11T00:00:00Z",
  );
  return stores;
}

describe("subscription domain", () => {
  it("subscribes with default status, changes status, unsubscribes", () => {
    const stores = seeded();
    expect(stores.subscriptions.get(1)?.status).toBe("Watching");
    setSubscriptionStatus(stores, 1, "Backlog");
    expect(stores.subscriptions.get(1)?.status).toBe("Backlog");
    expect(() => setSubscriptionStatus(stores, 999, "Paused")).toThrow();
    unsubscribe(stores, 1);
    expect(stores.subscriptions.get(1)).toBeUndefined();
    expect(stores.episodes.listByShow(1)).toHaveLength(0);
  });
});

describe("watch domain", () => {
  it("markUpToHere, progress, nextUnwatched", () => {
    const stores = seeded();
    markUpToHere(stores, 1002);
    expect(seasonProgress(stores, "1:S1")).toEqual({ watched: 2, total: 3 });
    expect(showProgress(stores, 1)).toEqual({ watched: 2, total: 3 });
    expect(nextUnwatched(stores, 1)?.tvmazeId).toBe(1003);
    setSeasonWatched(stores, "1:S1", true);
    expect(nextUnwatched(stores, 1)).toBeUndefined();
    setSeasonWatched(stores, "1:S1", false);
    expect(showProgress(stores, 1)).toEqual({ watched: 0, total: 3 });
    expect(() => markUpToHere(stores, 9999)).toThrow();
  });
});

describe("schedule domain", () => {
  it("returns future-only items with Central display + countdown", () => {
    const stores = seeded();
    const items = getUpcoming(
      stores.episodes,
      { limit: 30, offset: 0 },
      () => new Date("2026-09-11T12:00:00-05:00"),
    );
    expect(items.map((i) => i.title)).toEqual(["E2", "E3"]);
    expect(items[0]?.showName).toBe("Alpha");
    expect(items[0]?.centralDisplay).toContain("2026");
    expect(items[0]?.countdown).toBe("in 32h");
    expect(items[0]?.airstamp).toBe("2026-09-12T20:00:00-05:00");
    expect(items[0]?.bucket).toBe("This week");
    expect(items[0]?.summary).toBe("Overview 2");
    expect(items[0]?.posterUrl).toBeNull();
    expect(items[1]?.bucket).toBe("Next week");
  });
});
