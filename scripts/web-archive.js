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

function normalizePayloadForOutputs(prepared, payload, config) {
  const sourceDate = resolveSourceDate(prepared, payload, config);
  const title = `AI Builders Daily · ${sourceDate}`;
  return {
    ...payload,
    date: sourceDate,
    title
  };
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

async function updateWebArchive(prepared, payload, config) {
  const outputDir = config.delivery?.web?.outputDir;
  if (!outputDir) {
    throw new Error('Web archive output directory is not configured');
  }

  await ensureWebShell(outputDir);

  const digestPath = join(outputDir, 'data', 'digests', `${payload.date}.json`);
  const latestPath = join(outputDir, 'data', 'latest.json');
  const indexPath = join(outputDir, 'data', 'index.json');
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
