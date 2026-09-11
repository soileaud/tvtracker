import { describe, expect, it, vi } from "vitest";
import { SonarrClient } from "../src/sonarr/index.js";

function mockFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (u.endsWith("/series"))
      return json([
        { id: 7, title: "Demo", tvdbId: 123, monitored: true },
        { id: 8, title: "Other", tvdbId: 999, monitored: false },
      ]);
    if (u.includes("/episode?seriesId=7"))
      return json([
        { seasonNumber: 1, episodeNumber: 1, monitored: true, hasFile: true },
        { seasonNumber: 1, episodeNumber: 2, monitored: true, hasFile: false },
      ]);
    if (u.includes("/queue"))
      return json({
        records: [
          {
            series: { id: 7 },
            episode: { seasonNumber: 1, episodeNumber: 2 },
            sizeleft: 100,
          },
          {
            series: { id: 8 },
            episode: { seasonNumber: 1, episodeNumber: 1 },
            sizeleft: 50,
          },
        ],
      });
    throw new Error(`unexpected ${u}`);
  });
}

describe("SonarrClient", () => {
  it("is null when env is missing", () => {
    expect(SonarrClient.fromEnv({})).toBeNull();
    expect(SonarrClient.fromEnv({ SONARR_URL: "http://x:8989" })).toBeNull();
  });

  it("maps series/episodes/queue by tvdb id", async () => {
    const client = new SonarrClient({
      baseUrl: "http://sonarr:8989/",
      apiKey: "k",
      fetchFn: mockFetch() as unknown as typeof fetch,
    });
    const status = await client.statusForTvdb(123);
    expect(status.matched).toBe(true);
    expect(status.monitored).toBe(true);
    expect(status.total).toBe(2);
    expect(status.withFiles).toBe(1);
    expect(status.downloadingCount).toBe(1);
    expect(status.files).toEqual([
      { seasonNo: 1, number: 1, monitored: true, hasFile: true, downloading: false },
      { seasonNo: 1, number: 2, monitored: true, hasFile: false, downloading: true },
    ]);
  });

  it("returns unmatched for unknown tvdb", async () => {
    const client = new SonarrClient({
      baseUrl: "http://sonarr:8989",
      apiKey: "k",
      fetchFn: mockFetch() as unknown as typeof fetch,
    });
    expect(await client.statusForTvdb(555)).toEqual({ matched: false });
  });
});
