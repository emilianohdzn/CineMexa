// Cliente HTTP de los collectors: User-Agent identificable, timeout y reintentos con espera
// ante 429/5xx (respetando Retry-After). Sin dependencias externas.
export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Inyectable para pruebas. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string, body: string) {
    super(`HTTP ${status} en ${url}: ${body.slice(0, 200)}`);
    this.status = status;
    this.url = url;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { headers = {}, timeoutMs = 60_000, retries = 3, fetchImpl = fetch, sleep = defaultSleep } = opts;
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers, signal: controller.signal });
      if (res.ok) return (await res.json()) as T;
      const body = await res.text();
      const retriable = res.status === 429 || res.status >= 500;
      if (!retriable || attempt >= retries) throw new HttpError(res.status, url, body);
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
    } catch (error) {
      if (error instanceof HttpError || attempt >= retries) throw error;
      await sleep(2 ** attempt * 1000); // error de red o timeout
    } finally {
      clearTimeout(timer);
    }
    attempt += 1;
  }
}
