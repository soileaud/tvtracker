import type {
  Episode,
  HistoryItem,
  Season,
  Show,
  ShowStatus,
  UpcomingItem,
} from "@tvtrack/model";

export interface SearchResult {
  tvmazeId: number;
  name: string;
  premiered: string | null;
  network: string | null;
  status: string | null;
  posterUrl: string | null;
}

export interface Progress {
  watched: number;
  total: number;
}

export interface NextUp {
  tvmazeId: number;
  seasonNo: number;
  number: number | null;
  title: string;
  airstamp: string | null;
}

export interface SubscriptionEntry {
  show: Show;
  status: ShowStatus;
  progress: Progress;
  nextUnwatched: NextUp | null;
}

export interface SeasonDetail {
  season: Season;
  episodes: (Episode & { watched: boolean })[];
  progress: Progress;
}

export interface ShowDetailResponse {
  show: Show;
  status: ShowStatus | null;
  rating: number | null;
  note: string | null;
  progress: Progress;
  nextUnwatched: Episode | null;
  seasons: SeasonDetail[];
}

export interface StatsSummary {
  showsTotal: number;
  showsBehind: number;
  episodesBehind: number;
  minutesBehind: number;
}

export interface SonarrStatus {
  configured: boolean;
  matched?: boolean;
  monitored?: boolean;
  total?: number;
  withFiles?: number;
  downloadingCount?: number;
}

export interface EpisodeFileState {
  seasonNo: number;
  number: number;
  monitored: boolean;
  hasFile: boolean;
  downloading: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send a JSON content-type when there is a body: Fastify rejects
  // empty bodies under application/json (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which broke every bodyless POST (Up to here, Refresh, Refresh all).
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  search: (q: string) =>
    req<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  subscriptions: (status?: ShowStatus) =>
    req<SubscriptionEntry[]>(
      status ? `/api/subscriptions?status=${status}` : "/api/subscriptions",
    ),
  subscribe: (tvmazeId: number, status: ShowStatus = "Watching") =>
    req<{ ok: true; showId: number }>("/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({ tvmazeId, status }),
    }),
  setStatus: (showId: number, status: ShowStatus) =>
    req<{ ok: true }>(`/api/subscriptions/${showId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  unsubscribe: (showId: number) =>
    req<{ ok: true }>(`/api/subscriptions/${showId}`, { method: "DELETE" }),
  upcoming: (limit = 30, offset = 0) =>
    req<{ items: UpcomingItem[]; nextOffset: number }>(
      `/api/upcoming?limit=${limit}&offset=${offset}`,
    ),
  showDetail: (showId: number) => req<ShowDetailResponse>(`/api/shows/${showId}`),
  setWatched: (episodeId: number, watched: boolean) =>
    req<{ ok: true }>(`/api/episodes/${episodeId}`, {
      method: "PATCH",
      body: JSON.stringify({ watched }),
    }),
  setSeasonWatched: (seasonId: string, watched: boolean) =>
    req<{ ok: true }>(`/api/seasons/${encodeURIComponent(seasonId)}/watched`, {
      method: "POST",
      body: JSON.stringify({ watched }),
    }),
  watchUpToHere: (episodeId: number) =>
    req<{ ok: true }>(`/api/episodes/${episodeId}/watch-up-to-here`, {
      method: "POST",
    }),
  refreshShow: (showId: number) =>
    req<{ ok: true }>(`/api/refresh/${showId}`, { method: "POST" }),
  refreshAll: () =>
    req<{ refreshed: number }>(`/api/refresh-all`, { method: "POST" }),
  patchSubscription: (
    showId: number,
    patch: { status?: ShowStatus; rating?: number | null; note?: string | null },
  ) =>
    req<{ ok: true }>(`/api/subscriptions/${showId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  stats: () => req<StatsSummary>("/api/stats"),
  sonarrStatus: (showId: number) =>
    req<SonarrStatus>(`/api/sonarr/status/${showId}`),
  sonarrEpisodes: (showId: number) =>
    req<{ configured: boolean; matched?: boolean; files?: EpisodeFileState[] }>(
      `/api/sonarr/episodes/${showId}`,
    ),
  history: (limit = 50, offset = 0) =>
    req<{ items: HistoryItem[]; nextOffset: number }>(
      `/api/history?limit=${limit}&offset=${offset}`,
    ),
};
