import { parseSitemapXml } from "./parse.js";
import type { SitemapEntry, SitemapFetchOptions } from "./types.js";

export class SitemapFetchError extends Error {
  readonly status: number | undefined;

  constructor(message: string, options?: ErrorOptions & { status?: number }) {
    super(message, { cause: options?.cause });
    this.name = "SitemapFetchError";
    this.status = options?.status;
  }
}

export class SitemapDepthError extends Error {
  constructor(url: string, depth: number) {
    super(`Maximum sitemap depth exceeded at "${url}" (depth: ${depth})`);
    this.name = "SitemapDepthError";
  }
}

const DEFAULT_OPTIONS = {
  maxDepth: 10,
  timeout: 10_000,
  userAgent: "sitemapxml-fetcher/1.0",
  concurrency: 5,
} satisfies Required<SitemapFetchOptions>;

export async function fetchSitemap(
  url: string,
  options?: SitemapFetchOptions,
): Promise<SitemapEntry[]> {
  const opts: Required<SitemapFetchOptions> = {
    maxDepth: options?.maxDepth ?? DEFAULT_OPTIONS.maxDepth,
    timeout: options?.timeout ?? DEFAULT_OPTIONS.timeout,
    userAgent: options?.userAgent ?? DEFAULT_OPTIONS.userAgent,
    concurrency: options?.concurrency ?? DEFAULT_OPTIONS.concurrency,
  };
  return fetchAndResolve(url, opts, 0, new Set<string>());
}

async function responseToXml(response: Response, url: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  const isGzip = contentType.includes("gzip") || url.toLowerCase().endsWith(".gz");
  if (!isGzip) {
    return response.text();
  }
  return new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).text();
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
  opts: Required<SitemapFetchOptions>,
  depth: number,
  seen: Set<string>,
): Promise<SitemapEntry[]> {
  if (seen.has(url)) return [];
  seen.add(url);

  if (depth > opts.maxDepth) {
    throw new SitemapDepthError(url, depth);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeout),
      headers: { "User-Agent": opts.userAgent },
    });
  } catch (err) {
    throw new SitemapFetchError(`Failed to fetch "${url}": ${String(err)}`, {
      cause: err,
    });
  }

  if (!response.ok) {
    throw new SitemapFetchError(`HTTP ${response.status} fetching "${url}"`, {
      status: response.status,
    });
  }

  const xml = await responseToXml(response, url);
  const parsed = parseSitemapXml(xml);

  if (parsed.type === "urlset") {
    return parsed.urls;
  }

  const results = await withConcurrency(
    parsed.sitemaps.map((s) => () => fetchAndResolve(s.loc, opts, depth + 1, seen)),
    opts.concurrency,
  );
  return results.flat();
}
