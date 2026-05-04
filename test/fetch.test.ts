import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchError, SitemapDepthError, fetchSitemap } from "../src/fetch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf8");

function mockOk(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

describe("fetchSitemap", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a regular sitemap and returns entries with meta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockOk(fixture("urlset.xml"))));
    const result = await fetchSitemap("https://example.com/sitemap.xml");
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]?.loc).toBe("https://example.com/page1");
    expect(result.meta.url).toBe("https://example.com/sitemap.xml");
    expect(result.meta.httpStatus).toBe(200);
    expect(result.meta.redirects).toBe(0);
  });

  it("recursively fetches sitemap index and collects all child URLs", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === "https://example.com/sitemap-index.xml")
        return Promise.resolve(mockOk(fixture("index.xml")));
      if (url === "https://example.com/urlset.xml")
        return Promise.resolve(mockOk(fixture("urlset.xml")));
      if (url === "https://example.com/nested.xml")
        return Promise.resolve(mockOk(fixture("nested.xml")));
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchSitemap("https://example.com/sitemap-index.xml");
    const locs = result.entries.map((e) => e.loc);
    expect(locs).toContain("https://example.com/page1");
    expect(locs).toContain("https://example.com/nested1");
    expect(result.entries).toHaveLength(5);
    // meta describes the initial fetch only
    expect(result.meta.url).toBe("https://example.com/sitemap-index.xml");
  });

  it("throws SitemapDepthError when maxDepth is exceeded", async () => {
    const indexXml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockOk(indexXml)));
    await expect(fetchSitemap("https://example.com/sitemap.xml", { maxDepth: 0 })).rejects.toThrow(
      SitemapDepthError,
    );
  });

  it("handles circular sitemap indexes without infinite recursion", async () => {
    const aXml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/b.xml</loc></sitemap></sitemapindex>`;
    const bXml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://example.com/a.xml") return Promise.resolve(mockOk(aXml));
        if (url === "https://example.com/b.xml") return Promise.resolve(mockOk(bXml));
        return Promise.reject(new Error(`Unexpected: ${url}`));
      }),
    );
    const result = await fetchSitemap("https://example.com/a.xml");
    expect(result.entries).toEqual([]);
  });

  it("throws FetchError on HTTP error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })));
    const err = await fetchSitemap("https://example.com/sitemap.xml").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).status).toBe(404);
  });

  it("throws FetchError on network failure with status null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network failure")));
    const err = await fetchSitemap("https://example.com/sitemap.xml").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).status).toBeNull();
  });

  it("passes custom userAgent in request headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockOk(fixture("urlset.xml")));
    vi.stubGlobal("fetch", mockFetch);

    await fetchSitemap("https://example.com/sitemap.xml", {
      userAgent: "MyBot/2.0",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/sitemap.xml",
      expect.objectContaining({
        headers: { "User-Agent": "MyBot/2.0" },
      }),
    );
  });

  describe("redirects", () => {
    it("follows redirects manually and counts them", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(null, {
              status: 301,
              headers: { Location: "https://example.com/sitemap-final.xml" },
            }),
          )
          .mockResolvedValueOnce(mockOk(fixture("urlset.xml"))),
      );
      const result = await fetchSitemap("https://example.com/sitemap.xml");
      expect(result.meta.redirects).toBe(1);
      expect(result.meta.finalUrl).toBe("https://example.com/sitemap-final.xml");
    });

    it("throws FetchError when redirect cap is exceeded", async () => {
      const redirect = new Response(null, {
        status: 301,
        headers: { Location: "https://example.com/loop.xml" },
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirect));
      const err = await fetchSitemap("https://example.com/sitemap.xml", {
        maxRedirects: 2,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(FetchError);
    });

    it("maxRedirects: 0 disables redirect following", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          new Response(null, {
            status: 301,
            headers: { Location: "https://example.com/sitemap-final.xml" },
          }),
        ),
      );
      const err = await fetchSitemap("https://example.com/sitemap.xml", {
        maxRedirects: 0,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(FetchError);
    });
  });

  describe("gzip support", () => {
    it("decompresses when Content-Type contains gzip", async () => {
      const body = gzipSync(Buffer.from(fixture("urlset.xml")));
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/x-gzip" },
          }),
        ),
      );
      const result = await fetchSitemap("https://example.com/sitemap.xml");
      expect(result.entries).toHaveLength(3);
      expect(result.entries[0]?.loc).toBe("https://example.com/page1");
    });

    it("decompresses when URL ends with .gz", async () => {
      const body = gzipSync(Buffer.from(fixture("urlset.xml")));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
      const result = await fetchSitemap("https://example.com/sitemap.xml.gz");
      expect(result.entries).toHaveLength(3);
      expect(result.entries[0]?.loc).toBe("https://example.com/page1");
    });
  });

  it("respects concurrency: 1 by fetching children sequentially", async () => {
    const callOrder: string[] = [];
    const indexXml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/s1.xml</loc></sitemap><sitemap><loc>https://example.com/s2.xml</loc></sitemap><sitemap><loc>https://example.com/s3.xml</loc></sitemap></sitemapindex>`;
    const childXml = (n: number) =>
      `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/p${n}</loc></url></urlset>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        callOrder.push(url);
        if (url === "https://example.com/index.xml") return Promise.resolve(mockOk(indexXml));
        const m = /s(\d)\.xml$/.exec(url);
        if (m) return Promise.resolve(mockOk(childXml(Number(m[1]))));
        return Promise.reject(new Error(`Unexpected: ${url}`));
      }),
    );

    const result = await fetchSitemap("https://example.com/index.xml", {
      concurrency: 1,
    });
    expect(result.entries).toHaveLength(3);
    const childCalls = callOrder.filter((u) => u !== "https://example.com/index.xml");
    expect(childCalls).toHaveLength(3);
  });

  it("throws FetchError when body exceeds maxSizeBytes", async () => {
    const bigXml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${"<url><loc>https://example.com/x</loc></url>".repeat(1000)}</urlset>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockOk(bigXml)));
    const err = await fetchSitemap("https://example.com/sitemap.xml", {
      maxSizeBytes: 100,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
  });

  it("handles a 2xx response with a null body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(fetchSitemap("https://example.com/sitemap.xml")).rejects.toThrow();
  });

  it("throws FetchError when a redirect is missing its Location header", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 301 })));
    const err = await fetchSitemap("https://example.com/sitemap.xml").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
  });

  it("throws FetchError when a redirect has an unparseable Location URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 301, headers: { Location: "http://[bad" } }),
        ),
    );
    const err = await fetchSitemap("https://example.com/sitemap.xml").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
  });
});
