// Minimal TVMaze HTTP client: single place for User-Agent, 429 backoff,
// and connection reuse. `fetchFn` is injectable for tests.

export interface HttpClientOptions {
  fetchFn?: typeof fetch;
  userAgent?: string;
  maxRetries?: number;
}

export class TVMazeHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class TVMazeClient {
  private fetchFn: typeof fetch;
  private userAgent: string;
  private maxRetries: number;

  constructor(opts: HttpClientOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.userAgent = opts.userAgent ?? "TVTrack/0.1 local-personal";
    this.maxRetries = opts.maxRetries ?? 4;
  }

  async get<T>(path: string): Promise<T> {
    let delayMs = 1000;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(`https://api.tvmaze.com${path}`, {
        headers: { "User-Agent": this.userAgent },
      });
      if (res.status === 429 && attempt < this.maxRetries) {
        const retryAfter = res.headers.get("retry-after");
        const wait = retryAfter ? Number(retryAfter) * 1000 : delayMs;
        await new Promise((r) => setTimeout(r, wait));
        delayMs *= 2;
        continue;
      }
      if (res.status === 404) {
        throw new TVMazeHttpError(404, `TVMaze: not found ${path}`);
      }
      if (!res.ok) {
        throw new TVMazeHttpError(res.status, `TVMaze: HTTP ${res.status} for ${path}`);
      }
      return (await res.json()) as T;
    }
  }
}
