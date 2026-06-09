#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';

import {
  REPO_DIR,
  SIDECAR_CONFIG_PATH,
  SIDECAR_STATE_PATH,
  dateKeyInTimeZone,
  loadSidecarConfig,
  loadSidecarState,
  log,
  normalizeDeliveryTargets,
  nowIso,
  resolveDeliveryKey,
  resolveScheduleWindow,
  saveSidecarState,
  withStateLock
} from './sidecar-common.js';
import {
  normalizePayloadForOutputs,
  publishWebArchiveToGit,
  updateWebArchive
} from './web-archive.js';

const DEFAULT_INPUT_JSON_PATH = '/tmp/follow-builders-sidecar-raw.json';
const DEFAULT_PAYLOAD_PATH = '/tmp/follow-builders-sidecar-payload.json';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    inputJsonPath: DEFAULT_INPUT_JSON_PATH,
    payloadPath: DEFAULT_PAYLOAD_PATH,
    skipDelivery: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--input-json':
        parsed.inputJsonPath = args[++index];
        break;
      case '--payload':
      case '--payload-file':
        parsed.payloadPath = args[++index];
        break;
      case '--skip-delivery':
        parsed.skipDelivery = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function deliverPayload(payloadPath, payload, prepared, config) {
  const targets = normalizeDeliveryTargets(config.delivery?.targets);
  const results = {};

  if (targets.includes('web')) {
    results.web = await updateWebArchive(prepared, payload, config);
    results.web.git = await publishWebArchiveToGit(payload, config.delivery?.web?.outputDir);
  }

  return {
    status: 'ok',
    targets,
    results
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const config = await loadSidecarConfig();
  const prepared = JSON.parse(await readFile(args.inputJsonPath, 'utf-8'));
  const rawPayload = JSON.parse(await readFile(args.payloadPath, 'utf-8'));
  const payload = await normalizePayloadForOutputs(prepared, rawPayload, config);
  await writeFile(args.payloadPath, `${JSON.stringify(payload, null, 2)}\n`);
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error('Payload must contain a non-empty items array');
  }

  const currentIso = nowIso();
  const schedule = resolveScheduleWindow(config, new Date(currentIso));
  const contentDate = payload?.date || prepared?.stats?.feedGeneratedAt || null;
  const deliveryKey = resolveDeliveryKey(config, schedule, /^\d{4}-\d{2}-\d{2}$/.test(String(contentDate || '')) ? contentDate : payload?.date);
  const commit = prepared.sidecar?.latestSupportedCommit || prepared.sidecar?.latestOverallCommit || null;
  const feedFingerprint = prepared.sidecar?.feedFingerprint || null;
  const deliveryResult = args.skipDelivery
    ? { status: 'dry_run' }
    : await deliverPayload(args.payloadPath, payload, prepared, config);

  await withStateLock(async () => {
    const state = await loadSidecarState();
    state.lastCheckedAt = currentIso;
    state.lastFeedCompatibility = prepared.sidecar?.upstreamFeeds || state.lastFeedCompatibility || null;
    state.lastCompatibilityWarnings = prepared.sidecar?.warnings || [];
    state.lastEvaluatedKey = schedule.key;
    state.lastEvaluatedCommitSha = commit?.sha || null;
    state.lastEvaluatedOutcome = args.skipDelivery ? 'agent_native_dry_run' : 'success';
    state.lastFeedFingerprint = feedFingerprint;
    if (commit?.committedAt) {
      state.lastObservedCommit = {
        sha: commit.sha,
        committedAt: commit.committedAt,
        subject: commit.subject,
        date: dateKeyInTimeZone(commit.committedAt, config.timezone)
      };
    }
    if (!args.skipDelivery) {
      state.lastDeliveredKey = deliveryKey;
      state.lastDeliveredCommitSha = commit?.sha || feedFingerprint;
      state.lastSuccessAt = currentIso;
    }
    await saveSidecarState(state);
  });

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    mode: 'agent_native',
    delivered: !args.skipDelivery,
    delivery: deliveryResult,
    configPath: SIDECAR_CONFIG_PATH,
    statePath: SIDECAR_STATE_PATH,
    items: payload.items.length,
    commit
  })}\n`);
}

main().catch((error) => {
  log('error', 'Agent-native payload send failed', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});
