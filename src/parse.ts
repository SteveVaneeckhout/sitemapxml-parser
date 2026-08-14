import { XMLParser } from "fast-xml-parser";
import type { ChangeFreq, ParsedSitemap, SitemapEntry, SitemapIndexEntry } from "./types.js";

export class SitemapParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SitemapParseError";
  }
}

const CHANGE_FREQS = new Set<string>([
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
]);

/**
 * `changefreq` is typed as a seven-value union, so anything outside it must not
 * reach the caller — a `switch` the compiler believes is exhaustive would fall
 * through on a value we invented. Case is normalised, then unknown values are
 * dropped rather than passed off as valid.
 */
function parseChangeFreq(raw: unknown): ChangeFreq | undefined {
  const value = String(raw).trim().toLowerCase();
  return CHANGE_FREQS.has(value) ? (value as ChangeFreq) : undefined;
}

/**
 * `Number("high")` is `NaN`, which is typed `number`, serialises to `null` and
 * poisons any comparison it touches. sitemaps.org bounds priority to 0.0–1.0,
 * so anything else is dropped too.
 */
function parsePriority(raw: unknown): number | undefined {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

// Constructed once — XMLParser is stateless after construction
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  trimValues: true,
  isArray: (tagName) => tagName === "url" || tagName === "sitemap",
});

export function parseSitemapXml(xml: string): ParsedSitemap {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new SitemapParseError("Failed to parse XML", { cause: err });
  }

  const root = parsed as Record<string, unknown>;

  if ("urlset" in root) {
    const rawUrls = (root["urlset"] as Record<string, unknown>)["url"];
    const urls = Array.isArray(rawUrls) ? (rawUrls as unknown[]).map(parseUrlEntry) : [];
    return { type: "urlset", urls };
  }

  if ("sitemapindex" in root) {
    const rawSitemaps = (root["sitemapindex"] as Record<string, unknown>)["sitemap"];
    const sitemaps = Array.isArray(rawSitemaps)
      ? (rawSitemaps as unknown[]).map(parseSitemapIndexEntry)
      : [];
    return { type: "sitemapindex", sitemaps };
  }

  throw new SitemapParseError("Unrecognized XML root: expected <urlset> or <sitemapindex>");
}

function parseUrlEntry(entry: unknown): SitemapEntry {
  const e = entry as Record<string, unknown>;
  const loc = String(e["loc"] ?? "");
  if (!loc) {
    throw new SitemapParseError("Missing required <loc> in <url>");
  }
  const result: SitemapEntry = { loc };
  if (e["lastmod"] !== undefined) result.lastmod = String(e["lastmod"]);
  if (e["changefreq"] !== undefined) {
    const changefreq = parseChangeFreq(e["changefreq"]);
    if (changefreq !== undefined) result.changefreq = changefreq;
  }
  if (e["priority"] !== undefined) {
    const priority = parsePriority(e["priority"]);
    if (priority !== undefined) result.priority = priority;
  }
  return result;
}

function parseSitemapIndexEntry(entry: unknown): SitemapIndexEntry {
  const e = entry as Record<string, unknown>;
  const loc = String(e["loc"] ?? "");
  if (!loc) {
    throw new SitemapParseError("Missing required <loc> in <sitemap>");
  }
  const result: SitemapIndexEntry = { loc };
  if (e["lastmod"] !== undefined) result.lastmod = String(e["lastmod"]);
  return result;
}
