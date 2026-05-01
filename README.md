# sitemapxml

A TypeScript library for downloading and parsing sitemap.xml files. Handles both regular sitemaps (`<urlset>`) and sitemap index files (`<sitemapindex>`), recursively fetching all child sitemaps automatically.

## Installation

```sh
npm install sitemapxml
```

Requires Node.js >= 24.15.0.

## Usage

### Fetch a sitemap

```ts
import { fetchSitemap } from "sitemapxml";

const urls = await fetchSitemap("https://example.com/sitemap.xml");

for (const url of urls) {
  console.log(url.loc, url.lastmod);
}
```

`fetchSitemap` transparently handles:

- **Regular sitemap** (`<urlset>`) — returns the URL entries directly.
- **Sitemap index** (`<sitemapindex>`) — fetches each child sitemap concurrently and returns all URL entries combined.
- **Gzip-compressed sitemaps** (`.gz`) — detected by `Content-Type` header or `.gz` URL suffix and decompressed automatically.

### Parse XML directly

If you already have the XML as a string:

```ts
import { parseSitemapXml } from "sitemapxml";

const parsed = parseSitemapXml(xmlString);

if (parsed.type === "urlset") {
  console.log(parsed.urls);
} else {
  console.log(parsed.sitemaps); // sitemap index entries
}
```

## API

### `fetchSitemap(url, options?)`

Downloads and parses a sitemap from a URL. Recursively resolves sitemap index files.

```ts
fetchSitemap(url: string, options?: SitemapFetchOptions): Promise<SitemapEntry[]>
```

| Option        | Type     | Default                    | Description                                                                                            |
| ------------- | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `maxDepth`    | `number` | `10`                       | Maximum recursion depth for sitemap index links. Depth 0 means the initial URL only, no child fetches. |
| `timeout`     | `number` | `10000`                    | Per-request timeout in milliseconds. Uses `AbortSignal.timeout()` internally.                          |
| `userAgent`   | `string` | `'sitemapxml-fetcher/1.0'` | `User-Agent` header sent with every request.                                                           |
| `concurrency` | `number` | `5`                        | Maximum number of child sitemaps fetched in parallel when resolving a sitemap index.                   |

### `parseSitemapXml(xml)`

Parses a raw XML string. Returns a discriminated union — check `result.type` to determine which kind of sitemap was parsed.

```ts
parseSitemapXml(xml: string): ParsedSitemap
```

## Types

```ts
interface SitemapEntry {
  loc: string;
  lastmod?: string; // ISO 8601 date string (may be partial, e.g. "2024-01")
  changefreq?: ChangeFreq;
  priority?: number; // 0.0 – 1.0
}

type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

// Returned by parseSitemapXml()
type ParsedSitemap = UrlSet | SitemapIndex;

interface UrlSet {
  type: "urlset";
  urls: SitemapEntry[];
}

interface SitemapIndex {
  type: "sitemapindex";
  sitemaps: SitemapIndexEntry[];
}

interface SitemapIndexEntry {
  loc: string;
  lastmod?: string;
}
```

## Errors

All errors are typed and can be caught with `instanceof`.

```ts
import { fetchSitemap, SitemapFetchError, SitemapDepthError, SitemapParseError } from "sitemapxml";

try {
  const urls = await fetchSitemap("https://example.com/sitemap.xml");
} catch (err) {
  if (err instanceof SitemapFetchError) {
    console.error("HTTP error", err.status, err.message);
  } else if (err instanceof SitemapDepthError) {
    console.error("Sitemap index too deeply nested:", err.message);
  } else if (err instanceof SitemapParseError) {
    console.error("Invalid XML:", err.message);
  }
}
```

| Error               | When thrown                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `SitemapFetchError` | Non-2xx HTTP response or network failure. Has a `.status` property for HTTP errors. |
| `SitemapDepthError` | A sitemap index chain exceeded `maxDepth`.                                          |
| `SitemapParseError` | Malformed XML or unrecognized root element.                                         |

## License

MIT
