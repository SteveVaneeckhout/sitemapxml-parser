export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: ChangeFreq;
  priority?: number;
}

export interface SitemapIndexEntry {
  loc: string;
  lastmod?: string;
}

export interface UrlSet {
  type: "urlset";
  urls: SitemapEntry[];
}

export interface SitemapIndex {
  type: "sitemapindex";
  sitemaps: SitemapIndexEntry[];
}

export type ParsedSitemap = UrlSet | SitemapIndex;

export type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export interface FetchMeta {
  url: string;
  finalUrl: string;
  httpStatus: number | null;
  contentType: string | null;
  redirects: number;
}

export interface FetchResult {
  entries: SitemapEntry[];
  meta: FetchMeta;
}

export interface FetchOptions {
  /**
   * Maximum recursion depth when following sitemap index links.
   * Depth 0 = only fetch the initial URL, do not follow any index links.
   * Defaults to 10.
   */
  maxDepth?: number;
  /**
   * Per-request timeout in milliseconds. Uses AbortSignal.timeout() internally.
   * Defaults to 10_000.
   */
  timeoutMs?: number;
  /**
   * User-Agent header sent with every HTTP request.
   * Defaults to 'sitemapxml-fetcher/1.0'.
   */
  userAgent?: string;
  /**
   * Maximum redirects to follow per request. 0 disables redirect following.
   * Defaults to 5.
   */
  maxRedirects?: number;
  /**
   * Maximum response body size in bytes. Defaults to 50 MiB.
   */
  maxSizeBytes?: number;
  /**
   * Maximum number of child sitemap index entries fetched in parallel.
   * Defaults to 5.
   */
  concurrency?: number;
}
