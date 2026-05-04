import { parseSitemapXml } from "./parse.js";
const DEFAULT_OPTIONS = {
  maxDepth: 10,
  timeoutMs: 10_000,
  userAgent: "sitemapxml-fetcher/1.0",
  maxRedirects: 5,
  maxSizeBytes: 50 * 1024 * 1024,
  concurrency: 5,
};
export class FetchError extends Error {
  url;
  status;
  constructor(message, url, status = null, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FetchError";
    this.url = url;
    this.status = status;
  }
}
export class SitemapDepthError extends Error {
  constructor(url, depth) {
    super(`Maximum sitemap depth exceeded at "${url}" (depth: ${depth})`);
    this.name = "SitemapDepthError";
  }
}
function resolveOptions(options) {
  return {
    maxDepth: options?.maxDepth ?? DEFAULT_OPTIONS.maxDepth,
    timeoutMs: options?.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
    userAgent: options?.userAgent ?? DEFAULT_OPTIONS.userAgent,
    maxRedirects: options?.maxRedirects ?? DEFAULT_OPTIONS.maxRedirects,
    maxSizeBytes: options?.maxSizeBytes ?? DEFAULT_OPTIONS.maxSizeBytes,
    concurrency: options?.concurrency ?? DEFAULT_OPTIONS.concurrency,
  };
}
export async function fetchSitemap(url, options) {
  const opts = resolveOptions(options);
  const { entries, meta } = await fetchInitial(url, opts);
  return { entries, meta };
}
async function fetchInitial(url, opts) {
  const seen = new Set();
  seen.add(url);
  const fetched = await fetchAndDecode(url, opts);
  const parsed = parseSitemapXml(fetched.body);
  const meta = {
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
async function withConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
async function fetchAndResolve(url, opts, depth, seen) {
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
async function fetchAndDecode(url, opts) {
  let currentUrl = url;
  let redirects = 0;
  while (true) {
    let response;
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
async function readBody(response, url, contentType, maxBytes) {
  const isGzip = (contentType ?? "").includes("gzip") || url.toLowerCase().endsWith(".gz");
  const stream = isGzip
    ? response.body.pipeThrough(new DecompressionStream("gzip"))
    : response.body;
  if (stream === null) return "";
  const reader = stream.getReader();
  const chunks = [];
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
