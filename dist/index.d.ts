export { fetchSitemap, SitemapFetchError, SitemapDepthError } from "./fetch.js";
export { parseSitemapXml, SitemapParseError } from "./parse.js";
export type {
  SitemapEntry,
  SitemapIndexEntry,
  SitemapIndex,
  ParsedSitemap,
  SitemapFetchOptions,
  UrlSet,
  ChangeFreq,
} from "./types.js";
