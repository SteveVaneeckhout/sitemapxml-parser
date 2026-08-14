import type { FetchOptions, FetchResult } from "./types.js";
export declare class FetchError extends Error {
    readonly url: string;
    readonly status: number | null;
    constructor(message: string, url: string, status?: number | null, cause?: unknown);
}
export declare class SitemapDepthError extends Error {
    constructor(url: string, depth: number);
}
export declare function fetchSitemap(url: string, options?: FetchOptions): Promise<FetchResult>;
