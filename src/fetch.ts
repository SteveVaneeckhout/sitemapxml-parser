import { parseSitemapXml } from "./parse.js";
import type { FetchMeta, FetchOptions, FetchResult, SitemapEntry } from "./types.js";

const DEFAULT_OPTIONS = {
  maxDepth: 10,
  timeoutMs: 10_000,
  userAgent: "sitemapxml-fetcher/1.0",
  maxRedirects: 5,
  maxSizeBytes: 50 * 1024 * 1024,
  concurrency: 5,
} satisfies Required<FetchOptions>;

export class FetchError extends Error {
  readonly url: string;
  readonly status: number | null;

  constructor(message: string, url: string, status: number | null = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FetchError";
    this.url = url;
    this.status = status;
  }
}

export class SitemapDepthError extends Error {
  constructor(url: string, depth: number) {
    super(`Maximum sitemap depth exceeded at "${url}" (depth: ${depth})`);
    this.name = "SitemapDepthError";
  }
}

interface ResolvedOptions {
  maxDepth: number;
  timeoutMs: number;
  userAgent: string;
  maxRedirects: number;
  maxSizeBytes: number;
  concurrency: number;
}

function resolveOptions(options?: FetchOptions): ResolvedOptions {
  return {
    maxDepth: options?.maxDepth ?? DEFAULT_OPTIONS.maxDepth,
    timeoutMs: options?.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
    userAgent: options?.userAgent ?? DEFAULT_OPTIONS.userAgent,
    maxRedirects: options?.maxRedirects ?? DEFAULT_OPTIONS.maxRedirects,
    maxSizeBytes: options?.maxSizeBytes ?? DEFAULT_OPTIONS.maxSizeBytes,
    concurrency: options?.concurrency ?? DEFAULT_OPTIONS.concurrency,
  };
}

export async function fetchSitemap(url: string, options?: FetchOptions): Promise<FetchResult> {
  const opts = resolveOptions(options);
  const { entries, meta } = await fetchInitial(url, opts);
  return { entries, meta };
}

interface InitialOutcome {
  entries: SitemapEntry[];
  meta: FetchMeta;
}

async function fetchInitial(url: string, opts: ResolvedOptions): Promise<InitialOutcome> {
  const seen = new Set<string>();
  seen.add(url);

  const fetched = await fetchAndDecode(url, opts);
  const parsed = parseSitemapXml(fetched.body);

  const meta: FetchMeta = {
    url,
    finalUrl: fetched.finalUrl,
    httpStatus: fetched.httpStatus,
    contentType: fetched.contentType,
    redirects: fetched.redirects,
  };

  if (parsed.type === "urlset") {
    return { entries: parsed.urls, meta };
  }

  const childResults = await withConcurrency(
    parsed.sitemaps.map((s) => () => fetchAndResolve(s.loc, opts, 1, seen)),
    opts.concurrency,
  );
  return { entries: childResults.flat(), meta };
}

async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length) as T[];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function fetchAndResolve(
  url: string,
  opts: ResolvedOptions,
  depth: number,
  seen: Set<string>,
): Promise<SitemapEntry[]> {
  if (seen.has(url)) return [];
  seen.add(url);

  if (depth > opts.maxDepth) {
    throw new SitemapDepthError(url, depth);
  }

  const fetched = await fetchAndDecode(url, opts);
  const parsed = parseSitemapXml(fetched.body);

  if (parsed.type === "urlset") {
    return parsed.urls;
  }

  const results = await withConcurrency(
    parsed.sitemaps.map((s) => () => fetchAndResolve(s.loc, opts, depth + 1, seen)),
    opts.concurrency,
  );
  return results.flat();
}

interface FetchedBody {
  body: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string | null;
  redirects: number;
}

async function fetchAndDecode(url: string, opts: ResolvedOptions): Promise<FetchedBody> {
  let currentUrl = url;
  let redirects = 0;

  while (true) {
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        headers: { "User-Agent": opts.userAgent },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      throw new FetchError(
        `Failed to fetch "${currentUrl}": ${String(err)}`,
        currentUrl,
        null,
        err,
      );
    }

    const { status } = response;
    if (status >= 300 && status < 400) {
      if (redirects >= opts.maxRedirects) {
        throw new FetchError(
          `Too many redirects (>${opts.maxRedirects}) fetching "${url}"`,
          currentUrl,
          status,
        );
      }
      const location = response.headers.get("Location");
      if (location === null) {
        throw new FetchError(
          `Redirect from "${currentUrl}" missing Location header`,
          currentUrl,
          status,
        );
      }
      try {
        currentUrl = new URL(location, currentUrl).href;
      } catch {
        throw new FetchError(
          `Redirect from "${currentUrl}" has invalid Location: ${location}`,
          currentUrl,
          status,
        );
      }
      redirects++;
      continue;
    }

    if (!response.ok) {
      throw new FetchError(`HTTP ${status} fetching "${currentUrl}"`, currentUrl, status);
    }

    const contentType = response.headers.get("content-type");
    const body = await readBody(response, currentUrl, contentType, opts.maxSizeBytes);
    return {
      body,
      finalUrl: currentUrl,
      httpStatus: status,
      contentType,
      redirects,
    };
  }
}

async function readBody(
  response: Response,
  url: string,
  contentType: string | null,
  maxBytes: number,
): Promise<string> {
  const isGzip = (contentType ?? "").includes("gzip") || url.toLowerCase().endsWith(".gz");
  const stream = isGzip
    ? response.body!.pipeThrough(new DecompressionStream("gzip"))
    : response.body;

  if (stream === null) return "";

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new FetchError(
          `Response body exceeds maxSizeBytes (${maxBytes}) at "${url}"`,
          url,
          response.status,
        );
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(combined);
}
