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

    // changefreq is a seven-value union and priority is a number in 0.0-1.0.
    // Values outside those must not reach the caller wearing those types.
    it("drops a changefreq outside the spec's vocabulary", () => {
      const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc><changefreq>occasionally</changefreq></url></urlset>`;
      const result = parseSitemapXml(xml);
      if (result.type !== "urlset") return;
      expect("changefreq" in (result.urls[0] ?? {})).toBe(false);
    });

    it("normalises the case of a valid changefreq", () => {
      const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc><changefreq>Daily</changefreq></url></urlset>`;
      const result = parseSitemapXml(xml);
      if (result.type !== "urlset") return;
      expect(result.urls[0]?.changefreq).toBe("daily");
    });

    it("drops a non-numeric priority rather than yielding NaN", () => {
      const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc><priority>high</priority></url></urlset>`;
      const result = parseSitemapXml(xml);
      if (result.type !== "urlset") return;
      expect("priority" in (result.urls[0] ?? {})).toBe(false);
    });

    it("drops a priority outside 0.0-1.0", () => {
      const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc><priority>7</priority></url><url><loc>https://example.com/b</loc><priority>-1</priority></url></urlset>`;
      const result = parseSitemapXml(xml);
      if (result.type !== "urlset") return;
      expect("priority" in (result.urls[0] ?? {})).toBe(false);
      expect("priority" in (result.urls[1] ?? {})).toBe(false);
    });

    it("keeps the boundary priorities 0 and 1", () => {
      const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc><priority>0</priority></url><url><loc>https://example.com/b</loc><priority>1.0</priority></url></urlset>`;
      const result = parseSitemapXml(xml);
      if (result.type !== "urlset") return;
      expect(result.urls[0]?.priority).toBe(0);
      expect(result.urls[1]?.priority).toBe(1);
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

  describe("character references", () => {
    const urlset = (body: string) =>
      `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
    const urls = (xml: string) => {
      const result = parseSitemapXml(xml);
      if (result.type !== "urlset") throw new Error("expected a urlset");
      return result.urls;
    };

    it("decodes the named XML entities", () => {
      const [entry] = urls(urlset(`<url><loc>https://example.com/a?x=1&amp;y=2</loc></url>`));
      expect(entry?.loc).toBe("https://example.com/a?x=1&y=2");
    });

    it("decodes hexadecimal character references in lastmod", () => {
      // A real CMS escapes the timezone '+' this way. Left encoded, the value
      // is a string no date parser accepts.
      const [entry] = urls(
        urlset(
          `<url><loc>https://example.com/a</loc><lastmod>2026-06-05T08:02:21&#x2B;00:00</lastmod></url>`,
        ),
      );
      expect(entry?.lastmod).toBe("2026-06-05T08:02:21+00:00");
      expect(Number.isNaN(Date.parse(entry?.lastmod ?? ""))).toBe(false);
    });

    it("decodes decimal character references in lastmod", () => {
      const [entry] = urls(
        urlset(
          `<url><loc>https://example.com/a</loc><lastmod>2026-06-05T08:02:21&#43;00:00</lastmod></url>`,
        ),
      );
      expect(entry?.lastmod).toBe("2026-06-05T08:02:21+00:00");
    });

    it("decodes character references in loc, which would otherwise be a wrong URL", () => {
      const [entry] = urls(urlset(`<url><loc>https://example.com/caf&#xE9;/a&#x2F;b</loc></url>`));
      expect(entry?.loc).toBe("https://example.com/café/a/b");
    });

    it("decodes character references in a sitemap index loc", () => {
      const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/s.xml?a=1&#x26;b=2</loc></sitemap></sitemapindex>`;
      const result = parseSitemapXml(xml);
      expect(result.type).toBe("sitemapindex");
      if (result.type !== "sitemapindex") return;
      expect(result.sitemaps[0]?.loc).toBe("https://example.com/s.xml?a=1&b=2");
    });

    it("leaves an unescaped value alone", () => {
      const [entry] = urls(
        urlset(
          `<url><loc>https://example.com/a</loc><lastmod>2026-06-05T08:02:21+00:00</lastmod></url>`,
        ),
      );
      expect(entry?.lastmod).toBe("2026-06-05T08:02:21+00:00");
    });
  });
});
