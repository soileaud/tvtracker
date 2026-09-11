import { describe, expect, it } from "vitest";
import { openStores } from "../src/store/sqlite/index.js";
import type { Episode, Show } from "@tvtrack/model";

function makeShow(id: number, name: string): Show {
  return {
    tvmazeId: id,
    name,
    network: "HBO",
    posterUrl: null,
    scheduleDays: ["Sunday"],
    scheduleTime: "21:00",
    showStatus: "Running",
    externals: { tvdb: null, imdb: null },
    lastSyncedAt: "2026-09-11T00:00:00Z",
  };
}

function makeEp(
  showId: number,
  seasonNo: number,
  num: number,
  airstamp: string,
): Episode {
  return {
    tvmazeId: showId * 1000 + seasonNo * 100 + num,
    showId,
    seasonId: `${showId}:S${seasonNo}`,
    seasonNo,
    number: num,
    title: `E${num}`,
    airdate: airstamp.slice(0, 10),
    airtime: "21:00",
    airstamp,
    runtime: 60,
    imageUrl: null,
    type: "regular",
    summary: null,
  };
}

describe("sqlite stores", () => {
  it("subscribes, lists future soonest-first with pagination, tracks watched", () => {
    const s = openStores(":memory:");
    s.shows.upsertShow(makeShow(1, "Alpha"));
    s.shows.upsertShow(makeShow(2, "Beta"));
    s.subscriptions.add({ showId: 1, status: "Watching", addedAt: "2026-09-11T00:00:00Z", rating: null, note: null });
    s.subscriptions.add({ showId: 2, status: "Backlog", addedAt: "2026-09-11T00:00:00Z", rating: 4, note: "Good" });

    s.seasons.upsertMany([
      { id: "1:S1", showId: 1, seasonNo: 1, episodeOrder: 3, premiereDate: null },
      { id: "2:S1", showId: 2, seasonNo: 1, episodeOrder: 1, premiereDate: null },
    ]);
    s.episodes.upsertMany([
      makeEp(1, 1, 1, "2026-09-01T20:00:00-05:00"), // past -> excluded
      makeEp(1, 1, 2, "2026-09-12T20:00:00-05:00"),
      makeEp(1, 1, 3, "2026-09-19T20:00:00-05:00"),
      makeEp(2, 1, 1, "2026-09-13T20:00:00-05:00"),
    ]);

    const page1 = s.episodes.listFutureSubscribed("2026-09-11T12:00:00-05:00", 2, 0);
    expect(page1.map((e) => e.title)).toEqual(["E2", "E1"]);
    expect(page1[0]?.showName).toBe("Alpha");
    const page2 = s.episodes.listFutureSubscribed("2026-09-11T12:00:00-05:00", 2, 2);
    expect(page2.map((e) => e.title)).toEqual(["E3"]);

    // Unsubscribed shows never appear
    s.subscriptions.remove(2);
    const after = s.episodes.listFutureSubscribed("2026-09-11T12:00:00-05:00", 10, 0);
    expect(after.every((e) => e.showId === 1)).toBe(true);
    expect(s.shows.getShow(2)).toBeUndefined();

    // Watched flags (ids: show*1000 + season*100 + num)
    expect(s.watched.isWatched(1102)).toBe(false);
    s.watched.setWatched(1102, true);
    expect(s.watched.isWatched(1102)).toBe(true);
    s.watched.setSeasonWatched("1:S1", true);
    expect(s.watched.watchedSet([1101, 1102, 1103]).size).toBe(3);
    s.watched.setSeasonWatched("1:S1", false);
    expect(s.watched.watchedSet([1101, 1102, 1103]).size).toBe(0);

    // Status filter
    expect(s.shows.listSubscribed("Watching").map((x) => x.name)).toEqual(["Alpha"]);
    s.subscriptions.setStatus(1, "Paused");
    expect(s.shows.listSubscribed("Paused").length).toBe(1);
  });

  it("records first-watch dates; bulk backfill excluded from history", () => {
    const s = openStores(":memory:");
    s.shows.upsertShow(makeShow(1, "Alpha"));
    s.subscriptions.add({ showId: 1, status: "Watching", addedAt: "2026-09-11T00:00:00Z", rating: null, note: null });
    s.seasons.upsertMany([
      { id: "1:S1", showId: 1, seasonNo: 1, episodeOrder: 2, premiereDate: null },
      { id: "1:S2", showId: 1, seasonNo: 2, episodeOrder: 1, premiereDate: null },
    ]);
    s.episodes.upsertMany([
      makeEp(1, 1, 1, "2026-09-01T20:00:00-05:00"),
      makeEp(1, 1, 2, "2026-09-02T20:00:00-05:00"),
      makeEp(1, 2, 1, "2026-09-09T20:00:00-05:00"),
    ]);

    s.watched.setWatched(1101, true, "2026-09-05T10:00:00Z");
    s.watched.setWatched(1102, true, "2026-09-06T10:00:00Z");
    s.watched.setSeasonWatched("1:S2", true); // backfill → NULL date

    const history = s.watched.listHistory(30, 0);
    expect(history.map((h) => h.title)).toEqual(["E2", "E1"]); // recent first
    expect(history[0]).toMatchObject({ showName: "Alpha", seasonNo: 1, watchedAt: "2026-09-06T10:00:00Z" });

    // First-watch date wins: re-marking keeps the original.
    s.watched.setWatched(1101, true, "2026-09-10T10:00:00Z");
    expect(s.watched.listHistory(30, 0)[1]?.watchedAt).toBe("2026-09-05T10:00:00Z");

    // Unwatch + re-watch records a new date.
    s.watched.setWatched(1101, false);
    s.watched.setWatched(1101, true, "2026-09-12T10:00:00Z");
    expect(s.watched.listHistory(30, 0)[0]?.watchedAt).toBe("2026-09-12T10:00:00Z");

    // Pagination.
    expect(s.watched.listHistory(1, 0)).toHaveLength(1);
    expect(s.watched.listHistory(1, 1)).toHaveLength(1);
  });
});
