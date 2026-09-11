import { describe, expect, it } from "vitest";
import { buildApp } from "../src/main.js";
import { openStores } from "../src/store/sqlite/index.js";
import { SyncService } from "../src/sync/index.js";
import type { ShowProvider, ShowDetail } from "../src/providers/index.js";
import type { Episode } from "@tvtrack/model";

function fakeDetail(id: number): ShowDetail {
  return {
    show: {
      tvmazeId: id,
      name: `Fake Show ${id}`,
      network: "Net",
      posterUrl: null,
      scheduleDays: ["Monday"],
      scheduleTime: "20:00",
      showStatus: "Running",
      externals: { tvdb: null, imdb: null },
      lastSyncedAt: null,
    },
    seasons: [{ id: `${id}:S1`, showId: id, seasonNo: 1, episodeOrder: 2, premiereDate: null }],
    episodes: [1, 2].map(
      (n): Episode => ({
        tvmazeId: id * 100 + n,
        showId: id,
        seasonId: `${id}:S1`,
        seasonNo: 1,
        number: n,
        title: `E${n}`,
        airdate: n === 1 ? "2026-09-01" : "2026-12-01",
        airtime: "20:00",
        airstamp: n === 1 ? "2026-09-01T20:00:00-05:00" : "2026-12-01T20:00:00-06:00",
        runtime: 45,
        imageUrl: null,
        type: "regular",
        summary: null,
      }),
    ),
  };
}

const detail: ShowDetail = fakeDetail(42);

const fakeProvider: ShowProvider = {
  searchShows: async () => [
    { tvmazeId: 42, name: "Fake Show", premiered: "2026-01-01", network: "Net", status: "Running", posterUrl: null },
  ],
  getShowDetail: async (tvmazeId: number) => fakeDetail(tvmazeId),
};

function testApp() {
  const stores = openStores(":memory:");
  const sync = new SyncService(stores, fakeProvider);
  return { stores, ...buildApp({ stores, provider: fakeProvider, sync }) };
}

describe("api", () => {
  it("subscribe -> upcoming -> track -> unsubscribe flow", async () => {
    const { app } = testApp();

    const search = await app.inject({ method: "GET", url: "/api/search?q=fake" });
    expect(search.json()).toHaveLength(1);

    const sub = await app.inject({
      method: "POST",
      url: "/api/subscriptions",
      payload: { tvmazeId: 42 },
    });
    expect(sub.statusCode).toBe(200);

    const subs = await app.inject({ method: "GET", url: "/api/subscriptions" });
    expect(subs.json()[0].progress).toEqual({ watched: 0, total: 2 });
    expect(subs.json()[0].nextUnwatched).toMatchObject({
      tvmazeId: 4201,
      seasonNo: 1,
      number: 1,
    });

    // Upcoming shows only the future episode (E1 aired 2026-09-01; "now" is real time,
    // E2 2026-12-01 is future — robust regardless of when the test runs only if
    // run before Dec 2026; assert shape + ordering instead of exact membership).
    const upcoming = await app.inject({ method: "GET", url: "/api/upcoming?limit=30&offset=0" });
    const body = upcoming.json() as { items: { airstamp: string }[]; nextOffset: number };
    const stamps = body.items.map((i) => i.airstamp);
    expect([...stamps].sort()).toEqual(stamps);
    expect(body.items.every((i) => i.airstamp > new Date().toISOString())).toBe(true);

    const detailRes = await app.inject({ method: "GET", url: "/api/shows/42" });
    expect(detailRes.json().seasons).toHaveLength(1);

    const watch = await app.inject({
      method: "PATCH",
      url: "/api/episodes/4201",
      payload: { watched: true },
    });
    expect(watch.statusCode).toBe(200);

    const upToHere = await app.inject({
      method: "POST",
      url: "/api/episodes/4202/watch-up-to-here",
    });
    expect(upToHere.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/shows/42" });
    expect(after.json().progress).toEqual({ watched: 2, total: 2 });
    expect(after.json().nextUnwatched).toBeNull();

    const bad = await app.inject({
      method: "PATCH",
      url: "/api/episodes/4201",
      payload: { watched: "yes" },
    });
    expect(bad.statusCode).toBe(400);

    // Regression: bodyless POSTs must work even when the client sends a
    // JSON content-type with an empty body (what browsers did pre-fix —
    // Fastify's default parser 400s with FST_ERR_CTP_EMPTY_JSON_BODY).
    const emptyJson = await app.inject({
      method: "POST",
      url: "/api/episodes/4202/watch-up-to-here",
      headers: { "content-type": "application/json" },
    });
    expect(emptyJson.statusCode).toBe(200);
    const emptyRefresh = await app.inject({
      method: "POST",
      url: "/api/refresh-all",
      headers: { "content-type": "application/json" },
    });
    expect(emptyRefresh.statusCode).toBe(200);

    const del = await app.inject({ method: "DELETE", url: "/api/subscriptions/42" });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/api/shows/42" });
    expect(gone.statusCode).toBe(404);
  });

  it("stats count aired unwatched episodes + runtime; patch rating/note", async () => {
    const { app } = testApp();
    await app.inject({ method: "POST", url: "/api/subscriptions", payload: { tvmazeId: 42 } });

    const stats = await app.inject({ method: "GET", url: "/api/stats" });
    expect(stats.json()).toMatchObject({
      showsTotal: 1,
      showsBehind: 1,
      episodesBehind: 1, // E1 aired 2026-09-01; E2 is future
      minutesBehind: 45,
    });

    // Backlog/Paused shows don't count as behind (same episodes, other show).
    await app.inject({
      method: "POST",
      url: "/api/subscriptions",
      payload: { tvmazeId: 43, status: "Backlog" },
    });
    const stats2 = await app.inject({ method: "GET", url: "/api/stats" });
    expect(stats2.json()).toMatchObject({
      showsTotal: 2,
      showsBehind: 1,
      episodesBehind: 1,
      minutesBehind: 45,
    });

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/subscriptions/42",
      payload: { rating: 4, note: "Peak TV" },
    });
    expect(patch.statusCode).toBe(200);
    const detail = await app.inject({ method: "GET", url: "/api/shows/42" });
    expect(detail.json()).toMatchObject({ rating: 4, note: "Peak TV" });

    const badRating = await app.inject({
      method: "PATCH",
      url: "/api/subscriptions/42",
      payload: { rating: 6 },
    });
    expect(badRating.statusCode).toBe(400);
    const empty = await app.inject({
      method: "PATCH",
      url: "/api/subscriptions/42",
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    const missing = await app.inject({
      method: "PATCH",
      url: "/api/subscriptions/999",
      payload: { rating: 3 },
    });
    expect(missing.statusCode).toBe(404);

    // Unsetting works and blank notes normalize to null.
    await app.inject({
      method: "PATCH",
      url: "/api/subscriptions/42",
      payload: { rating: null, note: "   " },
    });
    const cleared = await app.inject({ method: "GET", url: "/api/shows/42" });
    expect(cleared.json()).toMatchObject({ rating: null, note: null });
  });

  it("history lists individually-marked watches, excludes season backfill", async () => {
    const { app } = testApp();
    await app.inject({ method: "POST", url: "/api/subscriptions", payload: { tvmazeId: 42 } });

    // Single toggle → in history.
    await app.inject({ method: "PATCH", url: "/api/episodes/4201", payload: { watched: true } });
    // Season bulk → watched but NOT in history.
    await app.inject({
      method: "POST",
      url: "/api/seasons/42%3AS1/watched",
      payload: { watched: true },
    });
    const history = await app.inject({ method: "GET", url: "/api/history?limit=30&offset=0" });
    const items = history.json().items as { title: string; watchedAt: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("E1");
    expect(typeof items[0]?.watchedAt).toBe("string");

    // Gap-fill shares one timestamp across the batch.
    const b = testApp();
    await b.app.inject({ method: "POST", url: "/api/subscriptions", payload: { tvmazeId: 42 } });
    await b.app.inject({ method: "POST", url: "/api/episodes/4202/watch-up-to-here" });
    const h2 = await b.app.inject({ method: "GET", url: "/api/history?limit=30&offset=0" });
    const items2 = h2.json().items as { title: string; watchedAt: string }[];
    expect(items2).toHaveLength(2);
    expect(items2[0]?.watchedAt).toBe(items2[1]?.watchedAt);

    // Clearing the date drops the row from History but keeps it watched.
    const clear = await b.app.inject({ method: "POST", url: "/api/episodes/4201/clear-date" });
    expect(clear.statusCode).toBe(200);
    const h3 = await b.app.inject({ method: "GET", url: "/api/history?limit=30&offset=0" });
    expect(h3.json().items).toHaveLength(1);
    const stillThere = await b.app.inject({ method: "GET", url: "/api/shows/42" });
    expect(stillThere.json().progress).toEqual({ watched: 2, total: 2 });
  });

  it("export/import round-trips subscriptions + watched", async () => {
    const a = testApp();
    await a.app.inject({ method: "POST", url: "/api/subscriptions", payload: { tvmazeId: 42 } });
    await a.app.inject({ method: "PATCH", url: "/api/episodes/4201", payload: { watched: true } });
    await a.app.inject({
      method: "PATCH",
      url: "/api/subscriptions/42",
      payload: { rating: 5, note: "Keep" },
    });
    const exp = await a.app.inject({ method: "GET", url: "/api/export" });
    expect(exp.statusCode).toBe(200);

    const b = testApp();
    const imp = await b.app.inject({ method: "POST", url: "/api/import", payload: exp.json() });
    expect(imp.json()).toEqual({ shows: 1 });
    const shows = await b.app.inject({ method: "GET", url: "/api/shows/42" });
    expect(shows.json().progress).toEqual({ watched: 1, total: 2 });
    expect(shows.json()).toMatchObject({ rating: 5, note: "Keep" });
    expect(shows.json().show.showStatus).toBe("Running");

    const badImport = await b.app.inject({
      method: "POST",
      url: "/api/import",
      payload: { nope: true },
    });
    expect(badImport.statusCode).toBe(400);
  });
});
