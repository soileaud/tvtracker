// Sonarr integration (optional). Matches TVTrack shows to Sonarr series by
// TVDB id and reports per-episode file/monitored/download state. Disabled
// (null client) unless SONARR_URL + SONARR_API_KEY are set — see docs/sonarr.md.
// Sonarr itself is not required on the dev machine; tests mock fetch.

export interface SonarrOptions {
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}

interface SonarrSeries {
  id: number;
  title: string;
  tvdbId: number;
  monitored: boolean;
}

interface SonarrEpisode {
  seasonNumber: number;
  episodeNumber: number;
  monitored: boolean;
  hasFile: boolean;
}

interface SonarrQueueRecord {
  series?: { id: number };
  episode?: { seasonNumber: number; episodeNumber: number };
  sizeleft?: number;
}

export interface EpisodeFileState {
  seasonNo: number;
  number: number;
  monitored: boolean;
  hasFile: boolean;
  downloading: boolean;
}

export interface ShowDownloadStatus {
  matched: boolean;
  monitored?: boolean;
  total?: number;
  withFiles?: number;
  downloadingCount?: number;
  files?: EpisodeFileState[];
}

export class SonarrClient {
  private baseUrl: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(opts: SonarrOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SonarrClient | null {
    const baseUrl = env.SONARR_URL?.trim();
    const apiKey = env.SONARR_API_KEY?.trim();
    if (!baseUrl || !apiKey) return null;
    return new SonarrClient({ baseUrl, apiKey });
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}/api/v3${path}`, {
      headers: { "X-Api-Key": this.apiKey },
    });
    if (!res.ok) throw new Error(`Sonarr: HTTP ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  private async seriesIdForTvdb(tvdbId: number): Promise<SonarrSeries | null> {
    const all = await this.get<SonarrSeries[]>("/series");
    return all.find((s) => s.tvdbId === tvdbId) ?? null;
  }

  async statusForTvdb(tvdbId: number): Promise<ShowDownloadStatus> {
    const series = await this.seriesIdForTvdb(tvdbId);
    if (!series) return { matched: false };
    const [episodes, queue] = await Promise.all([
      this.get<SonarrEpisode[]>(`/episode?seriesId=${series.id}`),
      this.get<{ records: SonarrQueueRecord[] }>(
        "/queue?page=1&pageSize=200&includeSeries=true&includeEpisode=true",
      ),
    ]);
    const downloading = new Set(
      (queue.records ?? [])
        .filter(
          (r) => r.series?.id === series.id && (r.sizeleft ?? 0) > 0 && r.episode,
        )
        .map((r) => `${r.episode!.seasonNumber}:${r.episode!.episodeNumber}`),
    );
    const files: EpisodeFileState[] = episodes.map((e) => ({
      seasonNo: e.seasonNumber,
      number: e.episodeNumber,
      monitored: e.monitored,
      hasFile: e.hasFile,
      downloading: downloading.has(`${e.seasonNumber}:${e.episodeNumber}`),
    }));
    return {
      matched: true,
      monitored: series.monitored,
      total: files.length,
      withFiles: files.filter((f) => f.hasFile).length,
      downloadingCount: files.filter((f) => f.downloading).length,
      files,
    };
  }
}
