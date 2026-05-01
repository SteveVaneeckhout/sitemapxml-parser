import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SitemapParseError, parseSitemapXml } from "../src/parse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf8");

describe("parseSitemapXml", () => {
  describe("urlset", () => {
    it("parses multi-URL urlset with all fields", () => {
      const result = parseSitemapXml(fixture("urlset.xml"));
      expect(result.type).toBe("urlset");
      if (result.type !== "urlset") return;
      expect(result.urls).toHaveLength(3);
      expect(result.urls[0]).toEqual({
        loc: "https://example.com/page1",
        lastmod: "2024-01-15",
        changefreq: "weekly",
        priority: 0.8,
      });
      expect(result.urls[2]).toEqual({ loc: "https://example.com/page3" });
    });

    it("handles single <url> entry as an array", () => {
      const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/only</loc></url></urlset>`;
      const result = parseSitemapXml(xml);
      expect(result.type).toBe("urlset");
      if (result.type !== "urlset") return;
      expect(Array.isArray(result.urls)).toBe(true);
      expect(result.urls).toHaveLength(1);
      expect(result.urls[0]?.loc).toBe("https://example.com/only");
    });

    it("returns only loc when optional fields are absent", () => {
      const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/bare</loc></url></urlset>`;
      const result = parseSitemapXml(xml);
      if (result.type !== "urlset") return;
      const entry = result.urls[0];
      expect(entry).toEqual({ loc: "https://example.com/bare" });
      expect("lastmod" in (entry ?? {})).toBe(false);
      expect("changefreq" in (entry ?? {})).toBe(false);
      expect("priority" in (entry ?? {})).toBe(false);
    });

    it("returns empty urls array for empty <urlset>", () => {
      const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
      const result = parseSitemapXml(xml);
      if (result.type !== "urlset") return;
      expect(result.urls).toEqual([]);
    });
  });

  describe("sitemapindex", () => {
    it("parses multi-sitemap index with all fields", () => {
      const result = parseSitemapXml(fixture("index.xml"));
      expect(result.type).toBe("sitemapindex");
      if (result.type !== "sitemapindex") return;
      expect(result.sitemaps).toHaveLength(2);
      expect(result.sitemaps[0]).toEqual({
        loc: "https://example.com/urlset.xml",
        lastmod: "2024-01-01",
      });
      expect(result.sitemaps[1]).toEqual({
        loc: "https://example.com/nested.xml",
      });
    });

    it("returns empty sitemaps array for empty <sitemapindex>", () => {
      const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>`;
      const result = parseSitemapXml(xml);
      if (result.type !== "sitemapindex") return;
      expect(result.sitemaps).toEqual([]);
    });

    it("handles single <sitemap> entry as an array", () => {
      const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/s.xml</loc></sitemap></sitemapindex>`;
      const result = parseSitemapXml(xml);
      expect(result.type).toBe("sitemapindex");
      if (result.type !== "sitemapindex") return;
      expect(Array.isArray(result.sitemaps)).toBe(true);
      expect(result.sitemaps).toHaveLength(1);
      expect(result.sitemaps[0]?.loc).toBe("https://example.com/s.xml");
    });
  });

  describe("errors", () => {
    it("throws SitemapParseError on malformed XML", () => {
      expect(() => parseSitemapXml("<unclosed")).toThrow(SitemapParseError);
    });

    it("throws SitemapParseError for non-XML string input", () => {
      expect(() => parseSitemapXml("not xml at all")).toThrow(SitemapParseError);
    });

    it("throws SitemapParseError for unknown root element", () => {
      expect(() => parseSitemapXml("<rss><channel></channel></rss>")).toThrow(SitemapParseError);
    });

    it("throws SitemapParseError for <url> missing <loc>", () => {
      const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><lastmod>2024-01-01</lastmod></url></urlset>`;
      expect(() => parseSitemapXml(xml)).toThrow(SitemapParseError);
    });

    it("throws SitemapParseError for <sitemap> missing <loc>", () => {
      const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><lastmod>2024-01-01</lastmod></sitemap></sitemapindex>`;
      expect(() => parseSitemapXml(xml)).toThrow(SitemapParseError);
    });
  });
});
