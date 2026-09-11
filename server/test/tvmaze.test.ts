import { describe, expect, it, vi } from "vitest";
import { TVMazeClient } from "../src/providers/tvmaze/client.js";
import { TVMazeAdapter } from "../src/providers/tvmaze/index.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("TVMazeClient", () => {
  it("backs off on 429 then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    const client = new TVMazeClient({ fetchFn: fetchFn as typeof fetch });
    const out = await client.get<{ ok: number }>("/shows/1");
    expect(out).toEqual({ ok: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      "User-Agent": expect.stringContaining("TVTrack"),
    });
  });

  it("throws 404 as typed error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("no", { status: 404 }));
    const client = new TVMazeClient({ fetchFn: fetchFn as typeof fetch });
    await expect(client.get("/shows/999999")).rejects.toMatchObject({ status: 404 });
  });
});

describe("TVMazeAdapter mapping", () => {
  const show = {
    id: 7,
    name: "Demo",
    premiered: "2020-01-01",
    status: "Running",
    network: { name: "HBO" },
    webChannel: null,
    schedule: { time: "21:00", days: ["Sunday"] },
    image: { medium: "m", original: "o" },
    externals: { tvdb: 123, imdb: "tt1" },
  };
  const fetchFn = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/search/shows")) return jsonResponse([{ score: 1, show }]);
    if (u.endsWith("/seasons")) return jsonResponse([{ id: 1, number: 1, episodeOrder: 2, premiereDate: "2020-01-01" }]);
    if (u.includes("/episodes")) {
      return jsonResponse([
        { id: 11, name: "Pilot", season: 1, number: 1, type: "regular", airdate: "2020-01-01", airtime: "21:00", airstamp: "2020-01-02T02:00:00+00:00", runtime: 60, image: null, summary: "<p>A <b>pilot</b> &amp; co.</p>" },
        { id: 12, name: "Special", season: 0, number: null, type: "significant_special", airdate: null, airtime: null, airstamp: null, runtime: null, image: null, summary: null },
      ]);
    }
    return jsonResponse(show);
  });

  it("maps search + detail incl. specials with synthesized S00", async () => {
    const adapter = new TVMazeAdapter(
      new TVMazeClient({ fetchFn: fetchFn as unknown as typeof fetch }),
    );
    const results = await adapter.searchShows("demo");
    expect(results[0]).toMatchObject({ tvmazeId: 7, name: "Demo", network: "HBO" });

    const detail = await adapter.getShowDetail(7);
    expect(detail.show).toMatchObject({ tvmazeId: 7, scheduleTime: "21:00", showStatus: "Running" });
    expect(detail.show.externals).toEqual({ tvdb: 123, imdb: "tt1" });
    expect(detail.seasons.map((s) => s.id).sort()).toEqual(["7:S0", "7:S1"]);
    expect(detail.episodes).toHaveLength(2);
    expect(detail.episodes.find((e) => e.seasonNo === 0)?.seasonId).toBe("7:S0");
    expect(detail.episodes[0]?.airstamp).toBe("2020-01-02T02:00:00+00:00");
    expect(detail.episodes[0]?.summary).toBe("A pilot & co.");
    expect(detail.episodes[1]?.summary).toBeNull();
  });
});
