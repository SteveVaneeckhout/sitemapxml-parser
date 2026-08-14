import type { ParsedSitemap } from "./types.js";
export declare class SitemapParseError extends Error {
    constructor(message: string, options?: ErrorOptions);
}
export declare function parseSitemapXml(xml: string): ParsedSitemap;
