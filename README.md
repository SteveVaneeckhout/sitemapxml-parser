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

const { entries, meta } = await fetchSitemap("https://example.com/sitemap.xml");

for (const url of entries) {
  console.log(url.loc, url.lastmod);
}

console.log(meta.httpStatus, meta.redirects); // describes the initial fetch
```

`fetchSitemap` transparently handles:

- **Regular sitemap** (`<urlset>`) — returns the URL entries directly.
- **Sitemap index** (`<sitemapindex>`) — fetches each child sitemap concurrently and returns all URL entries combined.
- **Gzip-compressed sitemaps** (`.gz`) — detected by `Content-Type` header or `.gz` URL suffix and decompressed automatically.
- **Redirects** — followed manually up to `maxRedirects`.

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

Downloads and parses a sitemap from a full URL. Recursively resolves sitemap index files.

```ts
fetchSitemap(url: string, options?: FetchOptions): Promise<FetchResult>
```

| Option         | Type     | Default                    | Description                                                                                            |
| -------------- | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `maxDepth`     | `number` | `10`                       | Maximum recursion depth for sitemap index links. Depth 0 means the initial URL only, no child fetches. |
| `timeoutMs`    | `number` | `10000`                    | Per-request timeout in milliseconds.                                                                   |
| `userAgent`    | `string` | `'sitemapxml-fetcher/1.0'` | `User-Agent` header sent with every request.                                                           |
| `maxRedirects` | `number` | `5`                        | Maximum redirects to follow per request (0 disables).                                                  |
| `maxSizeBytes` | `number` | `50 * 1024 * 1024`         | Maximum response body size in bytes.                                                                   |
| `concurrency`  | `number` | `5`                        | Maximum number of child sitemaps fetched in parallel when resolving a sitemap index.                   |

### `parseSitemapXml(xml)`

Parses a raw XML string. Returns a discriminated union — check `result.type` to determine which kind of sitemap was parsed.

```ts
parseSitemapXml(xml: string): ParsedSitemap
```

## Types

```ts
interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: ChangeFreq;
  priority?: number;
}

type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

// `changefreq` and `priority` are validated against the sitemaps.org spec, so
// the values you get always match the types above. A `changefreq` outside the
// vocabulary, or a `priority` that is not a number within 0.0–1.0, is dropped
// rather than passed through — the field is simply absent. Recognised
// `changefreq` values are lowercased, so "Daily" arrives as "daily".

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

// Returned by fetchSitemap()
interface FetchResult {
  entries: SitemapEntry[];
  meta: FetchMeta;
}

interface FetchMeta {
  url: string; // the URL that was requested
  finalUrl: string; // URL after redirects
  httpStatus: number | null;
  contentType: string | null;
  redirects: number;
}
```

`meta` describes the **initial** HTTP request only. When the initial URL is a sitemap index, child sitemap fetches happen but their HTTP details are not exposed.

## Errors

All errors are typed and can be caught with `instanceof`.

```ts
import { fetchSitemap, FetchError, SitemapDepthError, SitemapParseError } from "sitemapxml";

try {
  const { entries } = await fetchSitemap("https://example.com/sitemap.xml");
} catch (err) {
  if (err instanceof FetchError) {
    console.error("HTTP error", err.status, err.message);
  } else if (err instanceof SitemapDepthError) {
    console.error("Sitemap index too deeply nested:", err.message);
  } else if (err instanceof SitemapParseError) {
    console.error("Invalid XML:", err.message);
  }
}
```

| Error               | When thrown                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FetchError`        | Non-2xx HTTP response, network failure, timeout, redirect cap exceeded, body size cap exceeded. Has a `.status` property (number for HTTP errors, `null` for network/timeout). |
| `SitemapDepthError` | A sitemap index chain exceeded `maxDepth`.                                                                                                                                     |
| `SitemapParseError` | Malformed XML or unrecognized root element.                                                                                                                                    |

## License

MIT
