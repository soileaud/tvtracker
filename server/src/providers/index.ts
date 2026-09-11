import type { Episode, Season, Show } from "@tvtrack/model";

// External-data ports (DESIGN §3.4, FR-0). TVMazeAdapter implements
// ShowProvider; a future TMDB adapter implements ArtworkProvider only
// (never air dates).

export interface ShowSummary {
  tvmazeId: number;
  name: string;
  premiered: string | null;
  network: string | null;
  status: string | null;
  posterUrl: string | null;
}

export interface ShowDetail {
  show: Show;
  seasons: Season[];
  episodes: Episode[]; // includes specials (S00)
}

export interface ShowProvider {
  searchShows(query: string): Promise<ShowSummary[]>;
  getShowDetail(tvmazeId: number): Promise<ShowDetail>;
}

export interface ArtworkProvider {
  getPoster(showId: number): Promise<string | null>;
}
