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

function findMatchingTweet(prepared, item, section) {
  if (!prepared || String(item?.source_label || '').toLowerCase() !== 'x') return null;
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

function enrichPayloadMedia(prepared, payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    ...payload,
    items: items.map((item) => ({
      ...item,
      sections: (Array.isArray(item.sections) ? item.sections : []).map((section) => {
        const tweet = findMatchingTweet(prepared, item, section);
        const media = tweet
          ? uniqueMedia([
            ...mediaCandidatesFromValue(tweet.media),
            ...mediaCandidatesFromValue(tweet.images),
            ...mediaCandidatesFromValue(tweet.photos),
            ...mediaCandidatesFromValue(tweet.attachments),
            ...mediaCandidatesFromValue(tweet.preview_image_url),
            ...mediaCandidatesFromValue(tweet.previewImageUrl)
          ])
          : [];
        return media.length > 0
          ? { ...section, media }
          : section;
      })
    }))
  };
}

function normalizePayloadForOutputs(prepared, payload, config) {
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
