import { XMLParser } from "fast-xml-parser";
export class SitemapParseError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "SitemapParseError";
  }
}
// Constructed once — XMLParser is stateless after construction
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  trimValues: true,
  isArray: (tagName) => tagName === "url" || tagName === "sitemap",
});
export function parseSitemapXml(xml) {
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new SitemapParseError("Failed to parse XML", { cause: err });
  }
  const root = parsed;
  if ("urlset" in root) {
    const rawUrls = root["urlset"]["url"];
    const urls = Array.isArray(rawUrls) ? rawUrls.map(parseUrlEntry) : [];
    return { type: "urlset", urls };
  }
  if ("sitemapindex" in root) {
    const rawSitemaps = root["sitemapindex"]["sitemap"];
    const sitemaps = Array.isArray(rawSitemaps) ? rawSitemaps.map(parseSitemapIndexEntry) : [];
    return { type: "sitemapindex", sitemaps };
  }
  throw new SitemapParseError("Unrecognized XML root: expected <urlset> or <sitemapindex>");
}
function parseUrlEntry(entry) {
  const e = entry;
  const loc = String(e["loc"] ?? "");
  if (!loc) {
    throw new SitemapParseError("Missing required <loc> in <url>");
  }
  const result = { loc };
  if (e["lastmod"] !== undefined) result.lastmod = String(e["lastmod"]);
  if (e["changefreq"] !== undefined) result.changefreq = String(e["changefreq"]);
  if (e["priority"] !== undefined) result.priority = Number(e["priority"]);
  return result;
}
function parseSitemapIndexEntry(entry) {
  const e = entry;
  const loc = String(e["loc"] ?? "");
  if (!loc) {
    throw new SitemapParseError("Missing required <loc> in <sitemap>");
  }
  const result = { loc };
  if (e["lastmod"] !== undefined) result.lastmod = String(e["lastmod"]);
  return result;
}
