import type { SitemapEntry, SitemapFetchOptions } from "./types.js";
export declare class SitemapFetchError extends Error {
  readonly status: number | undefined;
  constructor(
    message: string,
    options?: ErrorOptions & {
      status?: number;
    },
  );
}
export declare class SitemapDepthError extends Error {
  constructor(url: string, depth: number);
}
export declare function fetchSitemap(
  url: string,
  options?: SitemapFetchOptions,
): Promise<SitemapEntry[]>;
