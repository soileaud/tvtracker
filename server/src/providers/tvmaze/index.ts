import type { Episode, Season, Show } from "@tvtrack/model";
import type {
  ShowDetail,
  ShowProvider,
  ShowSummary,
} from "../index.js";
import { TVMazeClient } from "./client.js";

// Raw TVMaze shapes (only the fields we use).
interface MazeImage {
  medium: string;
  original: string;
}
interface MazeShow {
  id: number;
  name: string;
  premiered: string | null;
  status: string | null;
  network: { name: string } | null;
  webChannel: { name: string } | null;
  schedule: { time: string; days: string[] };
  image: MazeImage | null;
  externals: { tvdb: number | null; imdb: string | null };
}
interface MazeSeason {
  id: number;
  number: number;
  episodeOrder: number | null;
  premiereDate: string | null;
}
interface MazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number | null;
  type: string;
  airdate: string | null;
  airtime: string | null;
  airstamp: string | null;
  runtime: number | null;
  image: MazeImage | null;
  summary: string | null;
}

export function seasonId(showId: number, seasonNo: number): string {
  return `${showId}:S${seasonNo}`;
}

/** TVMaze summaries are HTML fragments ("<p>…</p>") — store plain text. */
export function plainText(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function mapShow(m: MazeShow, syncedAt: string): Show {
  return {
    tvmazeId: m.id,
    name: m.name,
    network: m.network?.name ?? m.webChannel?.name ?? null,
    posterUrl: m.image?.medium ?? null,
    scheduleDays: m.schedule.days ?? [],
    scheduleTime: m.schedule.time || null,
    showStatus: m.status ?? null,
    externals: {
      tvdb: m.externals.tvdb ?? null,
      imdb: m.externals.imdb ?? null,
    },
    lastSyncedAt: syncedAt,
  };
}

export class TVMazeAdapter implements ShowProvider {
  constructor(private client: TVMazeClient = new TVMazeClient()) {}

  async searchShows(query: string): Promise<ShowSummary[]> {
    const res = await this.client.get<{ show: MazeShow }[]>(
      `/search/shows?q=${encodeURIComponent(query)}`,
    );
    return res.map(({ show: m }) => ({
      tvmazeId: m.id,
      name: m.name,
      premiered: m.premiered,
      network: m.network?.name ?? m.webChannel?.name ?? null,
      status: m.status,
      posterUrl: m.image?.medium ?? null,
    }));
  }

  async getShowDetail(tvmazeId: number): Promise<ShowDetail> {
    const now = new Date().toISOString();
    const [m, mazeSeasons, mazeEpisodes] = await Promise.all([
      this.client.get<MazeShow>(`/shows/${tvmazeId}`),
      this.client.get<MazeSeason[]>(`/shows/${tvmazeId}/seasons`),
      this.client.get<MazeEpisode[]>(`/shows/${tvmazeId}/episodes?specials=1`),
    ]);
    const show = mapShow(m, now);
    const seasons: Season[] = mazeSeasons.map((s) => ({
      id: seasonId(tvmazeId, s.number),
      showId: tvmazeId,
      seasonNo: s.number,
      episodeOrder: s.episodeOrder,
      premiereDate: s.premiereDate,
    }));
    const seasonIds = new Set(seasons.map((s) => s.id));
    // TVMaze can return episodes for seasons missing from /seasons;
    // synthesize the season row so FKs stay valid.
    for (const e of mazeEpisodes) {
      const id = seasonId(tvmazeId, e.season);
      if (!seasonIds.has(id)) {
        seasonIds.add(id);
        seasons.push({
          id,
          showId: tvmazeId,
          seasonNo: e.season,
          episodeOrder: null,
          premiereDate: null,
        });
      }
    }
    const episodes: Episode[] = mazeEpisodes.map((e) => ({
      tvmazeId: e.id,
      showId: tvmazeId,
      seasonId: seasonId(tvmazeId, e.season),
      seasonNo: e.season,
      number: e.number,
      title: e.name,
      airdate: e.airdate,
      airtime: e.airtime,
      airstamp: e.airstamp,
      runtime: e.runtime,
      imageUrl: e.image?.medium ?? null,
      type: (e.type ?? "regular") as Episode["type"],
      summary: plainText(e.summary),
    }));
    return { show, seasons, episodes };
  }
}
