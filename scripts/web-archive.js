#!/usr/bin/env node

import { execFile } from 'child_process';
import { basename, join } from 'path';
import { promisify } from 'util';

import {
  DEFAULT_TIMEZONE,
  REPO_DIR,
  dateKeyInTimeZone
} from './sidecar-common.js';
import {
  ensureDir,
  readJsonFile,
  writeJsonFile,
  writeTextFile
} from './sidecar-fs.js';

const execFileAsync = promisify(execFile);
const SHORT_URL_HOSTS = new Set(['t.co']);
const TWEET_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
const MEDIA_URL_PATTERN = /\.(?:png|jpe?g|gif|webp|avif|svg|mp4|mov|m4v|m3u8)(?:[?#].*)?$/i;
const HTML_ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
  '&nbsp;': ' '
};

function resolveSourceDate(prepared, payload, config) {
  const timezone = config.timezone || DEFAULT_TIMEZONE;
  const candidates = [
    prepared?.stats?.feedGeneratedAt,
    prepared?.sidecar?.latestSupportedCommit?.committedAt,
    prepared?.sidecar?.latestOverallCommit?.committedAt,
    payload?.date
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(candidate))
      ? String(candidate)
      : dateKeyInTimeZone(candidate, timezone);
  }
  return dateKeyInTimeZone(new Date(), timezone);
}

function mediaCandidatesFromValue(value) {
  if (!value) return [];
  if (typeof value === 'string') {
    return /^https?:\/\//.test(value) ? [{ url: value, alt: '' }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => mediaCandidatesFromValue(entry));
  }
  if (typeof value !== 'object') return [];

  const directUrl = value.url || value.image_url || value.imageUrl || value.src || value.thumbnail_url || value.thumbnailUrl;
  const nested = [
    value.media,
    value.images,
    value.photos,
    value.attachments,
    value.items
  ].flatMap((entry) => mediaCandidatesFromValue(entry));

  const current = directUrl ? [{
    url: directUrl,
    alt: value.alt || value.text || value.label || ''
  }] : [];

  return [...current, ...nested];
}

function uniqueMedia(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = entry?.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodeHtmlEntities(text) {
  return String(text || '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITY_MAP[entity] || entity);
}

function stripHtml(text) {
  return decodeHtmlEntities(String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeUrlCandidate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const sanitized = raw
    .replace(/^[<(]+/, '')
    .replace(/[)>.,!?;:]+$/, '');
  if (!/^https?:\/\//i.test(sanitized)) return null;
  try {
    return new URL(sanitized).toString();
  } catch {
    return null;
  }
}

function uniqueUrlStrings(urls) {
  const seen = new Set();
  return urls.filter((entry) => {
    if (!entry || seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
}

function extractTextUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  return uniqueUrlStrings(matches.map((entry) => normalizeUrlCandidate(entry)).filter(Boolean));
}

function extractMetaContent(html, attr, value) {
  const pattern = new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${value}["'][^>]*>`, 'i');
  const match = html.match(pattern) || html.match(reversePattern);
  return match ? decodeHtmlEntities(match[1].trim()) : '';
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : '';
}

function formatTweetPreviewDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    const textMatch = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s+\d{4})?$/);
    return textMatch ? `${textMatch[1].slice(0, 3)} ${textMatch[2]}` : raw;
  }
  const month = parsed.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = parsed.toLocaleString('en-US', { day: 'numeric', timeZone: 'UTC' });
  return `${month} ${day}`;
}

function applySyndicationTextExpansions(text, syndication) {
  let output = String(text || '');
  const replacements = [];

  for (const entry of Array.isArray(syndication?.entities?.urls) ? syndication.entities.urls : []) {
    const shortUrl = normalizeUrlCandidate(entry?.url);
    const expandedUrl = normalizeUrlCandidate(entry?.expanded_url || entry?.expandedUrl);
    if (shortUrl && expandedUrl) {
      replacements.push({ shortUrl, replacement: expandedUrl });
    }
  }

  for (const entry of Array.isArray(syndication?.entities?.media) ? syndication.entities.media : []) {
    const shortUrl = normalizeUrlCandidate(entry?.url);
    if (shortUrl) {
      replacements.push({ shortUrl, replacement: '' });
    }
  }

  for (const entry of replacements.sort((left, right) => right.shortUrl.length - left.shortUrl.length)) {
    output = output.split(entry.shortUrl).join(entry.replacement);
  }

  return output
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isTweetStatusUrl(url) {
  try {
    const parsed = new URL(url);
    return TWEET_HOSTS.has(parsed.hostname.toLowerCase()) && /\/[^/]+\/status\/\d+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeTweetStatusUrl(url) {
  const normalized = normalizeUrlCandidate(url);
  if (!normalized || !isTweetStatusUrl(normalized)) return normalized;
  try {
    const parsed = new URL(normalized);
    if (TWEET_HOSTS.has(parsed.hostname.toLowerCase())) {
      parsed.hostname = 'x.com';
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[1].toLowerCase() === 'status') {
      parts[0] = parts[0].toLowerCase();
      parsed.pathname = `/${parts.join('/')}`;
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function isDirectMediaUrl(url) {
  return MEDIA_URL_PATTERN.test(String(url || ''));
}

function inferMediaKind(url, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (/\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i.test(String(url || ''))) return 'image';
  if (/\.(?:mp4|mov|m4v|m3u8)(?:[?#].*)?$/i.test(String(url || ''))) return 'video';
  return null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  return fetch(url, {
    ...options,
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
}

const resolvedUrlCache = new Map();
const tweetPreviewCache = new Map();
const externalPreviewCache = new Map();
const tweetSyndicationCache = new Map();

function tweetIdFromUrl(url) {
  const normalized = normalizeUrlCandidate(url);
  if (!normalized) return null;
  const match = normalized.match(/\/status\/(\d+)/i);
  return match ? match[1] : null;
}

function findMatchingTweet(prepared, item, section) {
  const sourceLabel = String(item?.source_label || '').toLowerCase();
  if (!prepared || (!sourceLabel.includes('x') && !sourceLabel.includes('twitter'))) return null;
  const builders = Array.isArray(prepared.x) ? prepared.x : [];
  const builder = builders.find((entry) => (
    (item.person_handle && entry.handle === item.person_handle) ||
    (item.person_name && entry.name === item.person_name)
  ));
  if (!builder) return null;
  const urls = (Array.isArray(section?.source_links) ? section.source_links : [])
    .map((entry) => (typeof entry === 'string' ? entry : entry?.url))
    .filter(Boolean);
  const tweets = Array.isArray(builder.tweets) ? builder.tweets : [];
  return tweets.find((tweet) => urls.includes(tweet.url)) || null;
}

async function resolveShortUrl(url) {
  const normalized = normalizeUrlCandidate(url);
  if (!normalized) return null;
  if (resolvedUrlCache.has(normalized)) return resolvedUrlCache.get(normalized);

  let resolved = normalized;
  try {
    const host = hostFromUrl(normalized);
    if (SHORT_URL_HOSTS.has(host)) {
      let response = await fetchWithTimeout(normalized, {
        method: 'HEAD',
        redirect: 'manual'
      });
      let location = response.headers.get('location');
      if (!location || (response.status >= 400 && response.status !== 405)) {
        response = await fetchWithTimeout(normalized, {
          method: 'GET',
          redirect: 'manual'
        });
        location = response.headers.get('location');
      }
      resolved = normalizeUrlCandidate(location) || normalized;
      if (resolved === normalized) {
        try {
          const { stdout } = await execFileAsync('curl', ['-fsS', '-I', normalized], {
            cwd: REPO_DIR,
            maxBuffer: 1024 * 1024,
            timeout: 10000
          });
          const curlLocation = stdout.match(/^location:\s*(.+)$/im)?.[1]?.trim() || '';
          resolved = normalizeUrlCandidate(curlLocation) || resolved;
        } catch {
          resolved = normalized;
        }
      }
    }
  } catch {
    resolved = normalized;
  }

  resolvedUrlCache.set(normalized, resolved);
  return resolved;
}

function buildTweetPreviewFromPreparedTweet(tweet) {
  if (!tweet?.quotedTweet?.url && !tweet?.quotedTweet?.text) return null;
  const authorHandle = tweet?.quotedTweet?.authorHandle || null;
  return {
    type: 'tweet',
    url: tweet.quotedTweet.url || null,
    resolvedUrl: tweet.quotedTweet.url || null,
    authorName: tweet?.quotedTweet?.authorName || authorHandle || 'Quoted post',
    authorHandle,
    authorUrl: tweet?.quotedTweet?.authorUrl || (authorHandle ? `https://x.com/${String(authorHandle).replace(/^@/, '')}` : null),
    text: tweet?.quotedTweet?.text || '',
    displayDate: null,
    provider: 'X'
  };
}

async function fetchTweetPreview(url) {
  const normalized = normalizeUrlCandidate(url);
  if (!normalized || !isTweetStatusUrl(normalized)) return null;
  if (tweetPreviewCache.has(normalized)) return tweetPreviewCache.get(normalized);

  let preview = null;
  try {
    const twitterUrl = normalized.replace('://x.com/', '://twitter.com/');
    const endpoint = `https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(twitterUrl)}`;
    const response = await fetchWithTimeout(endpoint, {}, 10000);
    if (response.ok) {
      const data = await response.json();
      const parsedAuthorUrl = normalizeUrlCandidate(data.author_url || '');
      const authorHandle = parsedAuthorUrl
        ? (() => {
          try {
            return new URL(parsedAuthorUrl).pathname.split('/').filter(Boolean)[0] || null;
          } catch {
            return null;
          }
        })()
        : null;
      const html = String(data.html || '');
      const paragraphMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
      const dateMatch = html.match(/<a href="[^"]+"[^>]*>([^<]+)<\/a>\s*<\/blockquote>/i);
      preview = {
        type: 'tweet',
        url: normalized,
        resolvedUrl: normalizeUrlCandidate(data.url) || normalized,
        authorName: data.author_name || authorHandle || 'Quoted post',
        authorHandle,
        authorUrl: parsedAuthorUrl,
        text: paragraphMatch ? stripHtml(paragraphMatch[1]) : '',
        displayDate: formatTweetPreviewDate(dateMatch?.[1] || ''),
        provider: data.provider_name || 'X'
      };
    }
  } catch {
    preview = null;
  }

  const syndication = await fetchTweetSyndication(normalized);
  if (preview && syndication) {
    preview = {
      ...preview,
      authorName: syndication?.user?.name || preview.authorName,
      authorHandle: syndication?.user?.screen_name || preview.authorHandle,
      authorUrl: syndication?.user?.screen_name ? `https://x.com/${syndication.user.screen_name}` : preview.authorUrl,
      text: applySyndicationTextExpansions(syndication?.text || preview.text, syndication),
      displayDate: formatTweetPreviewDate(syndication?.created_at || preview.displayDate)
    };
  }

  tweetPreviewCache.set(normalized, preview);
  return preview;
}

function mergeTweetPreview(basePreview, enrichedPreview) {
  if (!basePreview) return enrichedPreview;
  if (!enrichedPreview) return basePreview;
  return {
    ...basePreview,
    ...enrichedPreview,
    text: enrichedPreview.text || basePreview.text || '',
    authorName: enrichedPreview.authorName || basePreview.authorName || '',
    authorHandle: enrichedPreview.authorHandle || basePreview.authorHandle || '',
    authorUrl: enrichedPreview.authorUrl || basePreview.authorUrl || '',
    displayDate: enrichedPreview.displayDate || basePreview.displayDate || null
  };
}

async function fetchTweetSyndication(url) {
  const tweetId = tweetIdFromUrl(url);
  if (!tweetId) return null;
  if (tweetSyndicationCache.has(tweetId)) return tweetSyndicationCache.get(tweetId);

  let data = null;
  try {
    const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=x`;
    const response = await fetchWithTimeout(endpoint, {}, 10000);
    if (response.ok) {
      data = await response.json();
    }
  } catch {
    data = null;
  }

  if (!data) {
    try {
      const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=x`;
      const { stdout } = await execFileAsync('curl', ['-fsSL', endpoint], {
        cwd: REPO_DIR,
        maxBuffer: 4 * 1024 * 1024,
        timeout: 10000
      });
      data = JSON.parse(stdout);
    } catch {
      data = null;
    }
  }

  tweetSyndicationCache.set(tweetId, data);
  return data;
}

async function fetchExternalPreview(url) {
  const normalized = normalizeUrlCandidate(url);
  if (!normalized) return null;
  if (externalPreviewCache.has(normalized)) return externalPreviewCache.get(normalized);

  let preview = null;
  try {
    const response = await fetchWithTimeout(normalized, {
      method: 'GET',
      redirect: 'follow'
    }, 10000);
    const contentType = response.headers.get('content-type') || '';
    const finalUrl = normalizeUrlCandidate(response.url) || normalized;
    const mediaKind = inferMediaKind(finalUrl, contentType);

    if (mediaKind) {
      preview = {
        type: 'link',
        url: normalized,
        resolvedUrl: finalUrl,
        siteName: hostFromUrl(finalUrl).replace(/^www\./, ''),
        title: mediaKind === 'image' ? 'Image preview' : 'Video preview',
        description: '',
        image: mediaKind === 'image' ? finalUrl : null,
        mediaKind
      };
    } else if (response.ok && contentType.includes('text/html')) {
      const html = await response.text();
      const title = extractMetaContent(html, 'property', 'og:title')
        || extractMetaContent(html, 'name', 'twitter:title')
        || extractMetaContent(html, 'name', 'title')
        || extractTitle(html);
      const description = extractMetaContent(html, 'property', 'og:description')
        || extractMetaContent(html, 'name', 'twitter:description')
        || extractMetaContent(html, 'name', 'description');
      const image = normalizeUrlCandidate(
        extractMetaContent(html, 'property', 'og:image')
        || extractMetaContent(html, 'name', 'twitter:image')
      );
      const siteName = extractMetaContent(html, 'property', 'og:site_name')
        || hostFromUrl(finalUrl).replace(/^www\./, '');
      if (title || description || image) {
        preview = {
          type: 'link',
          url: normalized,
          resolvedUrl: finalUrl,
          siteName,
          title: title || siteName,
          description,
          image,
          mediaKind: image ? 'image' : null
        };
      }
    }
  } catch {
    preview = null;
  }

  externalPreviewCache.set(normalized, preview);
  return preview;
}

function collectPreviewUrls(section, tweet) {
  return uniqueUrlStrings([
    ...extractTextUrls(section?.body),
    ...extractTextUrls(tweet?.text),
    normalizeUrlCandidate(tweet?.quotedTweet?.url)
  ].filter(Boolean));
}

function mediaCandidatesFromSyndication(data) {
  if (!data || typeof data !== 'object') return [];
  const photos = Array.isArray(data.photos) ? data.photos.map((entry) => ({
    shortUrl: normalizeUrlCandidate(entry?.expandedUrl) ? null : null,
    url: normalizeUrlCandidate(entry?.url),
    alt: '',
    expandedUrl: normalizeUrlCandidate(entry?.expandedUrl)
  })) : [];
  const details = Array.isArray(data.mediaDetails) ? data.mediaDetails.map((entry) => ({
    shortUrl: normalizeUrlCandidate(entry?.url),
    url: normalizeUrlCandidate(entry?.media_url_https || entry?.media_url || entry?.url),
    alt: '',
    expandedUrl: normalizeUrlCandidate(entry?.expanded_url || entry?.expandedUrl)
  })) : [];
  return uniqueMedia([...photos, ...details].filter((entry) => entry?.url));
}

async function buildLinkExpansions(section, tweet, tweetPreview) {
  const currentSyndication = await fetchTweetSyndication(tweet?.url);
  const quoteResolvedUrl = normalizeTweetStatusUrl(tweetPreview?.resolvedUrl) || normalizeTweetStatusUrl(tweet?.quotedTweet?.url);
  const expandedByShortUrl = new Map(
    (Array.isArray(currentSyndication?.entities?.urls) ? currentSyndication.entities.urls : [])
      .map((entry) => {
        const shortUrl = normalizeUrlCandidate(entry?.url);
        const expandedUrl = normalizeUrlCandidate(entry?.expanded_url || entry?.expandedUrl);
        if (!shortUrl || !expandedUrl) return null;
        return [shortUrl, expandedUrl];
      })
      .filter(Boolean)
  );
  const mediaByShortUrl = new Map(
    (Array.isArray(currentSyndication?.mediaDetails) ? currentSyndication.mediaDetails : [])
      .map((entry) => {
        const shortUrl = normalizeUrlCandidate(entry?.url);
        if (!shortUrl) return null;
        return [shortUrl, {
          kind: 'media',
          shortUrl,
          resolvedUrl: normalizeUrlCandidate(entry?.expanded_url || entry?.expandedUrl || entry?.media_url_https || entry?.media_url || entry?.url),
          mediaUrl: normalizeUrlCandidate(entry?.media_url_https || entry?.media_url || null)
        }];
      })
      .filter(Boolean)
  );

  const urls = collectPreviewUrls(section, tweet)
    .filter((url) => hostFromUrl(url) === 't.co');

  const expansions = [];
  for (const shortUrl of urls) {
    if (mediaByShortUrl.has(shortUrl)) {
      expansions.push(mediaByShortUrl.get(shortUrl));
      continue;
    }

    const resolvedUrl = expandedByShortUrl.get(shortUrl) || await resolveShortUrl(shortUrl);
    if (!resolvedUrl) continue;

    if (quoteResolvedUrl && normalizeTweetStatusUrl(resolvedUrl) === quoteResolvedUrl) {
      expansions.push({
        kind: 'quote',
        shortUrl,
        resolvedUrl: normalizeTweetStatusUrl(resolvedUrl)
      });
      continue;
    }

    if (normalizeUrlCandidate(resolvedUrl) === normalizeUrlCandidate(tweet?.url)) {
      expansions.push({
        kind: 'self',
        shortUrl,
        resolvedUrl: normalizeUrlCandidate(resolvedUrl)
      });
      continue;
    }

    expansions.push({
      kind: 'external',
      shortUrl,
      resolvedUrl: normalizeUrlCandidate(resolvedUrl)
    });
  }

  return expansions;
}

async function buildSectionPreviews(section, tweet) {
  const previews = [];
  const seen = new Set();

  const preparedQuotePreview = buildTweetPreviewFromPreparedTweet(tweet);
  const fetchedQuotePreview = await fetchTweetPreview(tweet?.quotedTweet?.url || '');
  const quotePreview = mergeTweetPreview(preparedQuotePreview, fetchedQuotePreview);

  if (quotePreview?.resolvedUrl) {
    const key = normalizeUrlCandidate(quotePreview.resolvedUrl);
    if (key) {
      seen.add(key);
      previews.push(quotePreview);
    }
  }

  for (const candidate of collectPreviewUrls(section, tweet)) {
    const resolvedUrl = await resolveShortUrl(candidate);
    const normalizedResolved = normalizeUrlCandidate(resolvedUrl) || normalizeUrlCandidate(candidate);
    if (!normalizedResolved || seen.has(normalizedResolved)) continue;
    if (normalizeUrlCandidate(tweet?.url) === normalizedResolved) continue;

    let preview = null;
    if (isTweetStatusUrl(normalizedResolved)) {
      preview = await fetchTweetPreview(normalizedResolved);
    }

    if (preview) {
      seen.add(normalizedResolved);
      previews.push(preview);
    }
  }

  return previews;
}

async function enrichPayloadMedia(prepared, payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    ...payload,
    items: await Promise.all(items.map(async (item) => ({
      ...item,
      sections: await Promise.all((Array.isArray(item.sections) ? item.sections : []).map(async (section) => {
        const tweet = findMatchingTweet(prepared, item, section);
        const quotePreviews = await buildSectionPreviews(section, tweet);
        const linkExpansions = await buildLinkExpansions(section, tweet, quotePreviews[0] || null);
        const media = tweet
          ? uniqueMedia([
            ...mediaCandidatesFromValue(tweet.media),
            ...mediaCandidatesFromValue(tweet.images),
            ...mediaCandidatesFromValue(tweet.photos),
            ...mediaCandidatesFromValue(tweet.attachments),
            ...mediaCandidatesFromValue(tweet.preview_image_url),
            ...mediaCandidatesFromValue(tweet.previewImageUrl),
            ...mediaCandidatesFromSyndication(await fetchTweetSyndication(tweet.url))
          ])
          : [];
        return {
          ...section,
          ...(media.length > 0 ? { media } : {}),
          ...(quotePreviews.length > 0 ? { previews: quotePreviews.filter((entry) => entry.type === 'tweet') } : {}),
          ...(linkExpansions.length > 0 ? { linkExpansions } : {})
        };
      }))
    })))
  };
}

async function normalizePayloadForOutputs(prepared, payload, config) {
  const sourceDate = resolveSourceDate(prepared, payload, config);
  const title = `AI Builders Daily · ${sourceDate}`;
  return enrichPayloadMedia(prepared, {
    ...payload,
    date: sourceDate,
    title
  });
}

function buildArchiveIndexEntry(payload, prepared, config) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    date: payload.date,
    title: payload.title,
    summary: payload.summary || '',
    itemCount: items.length,
    siteUrl: config.delivery?.web?.siteUrl || null,
    updatedAt: new Date().toISOString(),
    commit: prepared?.sidecar?.latestSupportedCommit || prepared?.sidecar?.latestOverallCommit || null
  };
}

async function ensureWebShell(outputDir) {
  await ensureDir(outputDir);
  await ensureDir(join(outputDir, 'data'));
  await ensureDir(join(outputDir, 'data', 'digests'));
}

async function buildSourcesManifest() {
  const sourceConfig = await readJsonFile(join(REPO_DIR, 'config', 'default-sources.json'), {
    blogs: [],
    podcasts: [],
    x_accounts: []
  });

  return {
    updatedAt: new Date().toISOString(),
    thanksTo: {
      label: 'zarazhangrui/follow-builders',
      url: 'https://github.com/zarazhangrui/follow-builders'
    },
    blogs: (Array.isArray(sourceConfig.blogs) ? sourceConfig.blogs : []).map((entry) => ({
      name: entry.name,
      url: entry.indexUrl || entry.articleBaseUrl || null
    })),
    podcasts: (Array.isArray(sourceConfig.podcasts) ? sourceConfig.podcasts : []).map((entry) => ({
      name: entry.name,
      url: entry.url
    })),
    x: (Array.isArray(sourceConfig.x_accounts) ? sourceConfig.x_accounts : []).map((entry) => ({
      name: entry.name,
      handle: entry.handle,
      url: entry.handle ? `https://x.com/${String(entry.handle).replace(/^@/, '')}` : null
    }))
  };
}

async function updateWebArchive(prepared, payload, config) {
  const outputDir = config.delivery?.web?.outputDir;
  if (!outputDir) {
    throw new Error('Web archive output directory is not configured');
  }

  await ensureWebShell(outputDir);

  const digestPath = join(outputDir, 'data', 'digests', `${payload.date}.json`);
  const latestPath = join(outputDir, 'data', 'latest.json');
  const indexPath = join(outputDir, 'data', 'index.json');
  const sourcesPath = join(outputDir, 'data', 'sources.json');
  const existingIndex = await readJsonFile(indexPath, {
    updatedAt: null,
    latestDate: null,
    dates: []
  });

  await writeJsonFile(digestPath, {
    payload,
    meta: {
      date: payload.date,
      updatedAt: new Date().toISOString(),
      commit: prepared?.sidecar?.latestSupportedCommit || prepared?.sidecar?.latestOverallCommit || null,
      generatedAt: prepared?.generatedAt || null,
      feedGeneratedAt: prepared?.stats?.feedGeneratedAt || null,
      timezone: config.timezone || DEFAULT_TIMEZONE
    }
  });

  await writeJsonFile(latestPath, {
    date: payload.date,
    digest: `./digests/${basename(digestPath)}`
  });

  const nextEntry = buildArchiveIndexEntry(payload, prepared, config);
  const byDate = new Map(
    (Array.isArray(existingIndex.dates) ? existingIndex.dates : [])
      .map((entry) => [entry.date, entry])
  );
  byDate.set(nextEntry.date, nextEntry);
  const dates = Array.from(byDate.values()).sort((left, right) => right.date.localeCompare(left.date));

  await writeJsonFile(indexPath, {
    updatedAt: new Date().toISOString(),
    latestDate: dates[0]?.date || payload.date,
    dates
  });

  await writeJsonFile(sourcesPath, await buildSourcesManifest());

  await writeTextFile(join(outputDir, '.nojekyll'), '');

  return {
    status: 'ok',
    outputDir,
    latestDate: dates[0]?.date || payload.date,
    digestPath,
    indexPath
  };
}

async function runGit(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: REPO_DIR,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180000
  });
  return stdout.trim();
}

async function publishWebArchiveToGit(payload, outputDir) {
  const relativeOutputDir = outputDir.startsWith(`${REPO_DIR}/`)
    ? outputDir.slice(REPO_DIR.length + 1)
    : basename(outputDir);
  const trackedPaths = [
    join(relativeOutputDir, 'data'),
    join(relativeOutputDir, '.nojekyll')
  ];

  const status = await runGit(['status', '--short', '--', ...trackedPaths]);
  if (!status.trim()) {
    return {
      status: 'skipped',
      reason: 'no_changes'
    };
  }

  await runGit(['add', '--', ...trackedPaths]);
  await runGit(['commit', '-m', `Update web archive for ${payload.date}`]);
  await runGit(['push', 'origin', 'main']);

  const commitSha = await runGit(['rev-parse', 'HEAD']);
  return {
    status: 'ok',
    branch: 'main',
    commitSha
  };
}

export {
  normalizePayloadForOutputs,
  publishWebArchiveToGit,
  updateWebArchive
};
