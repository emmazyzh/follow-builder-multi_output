#!/usr/bin/env node

import { fileURLToPath } from 'url';

import {
  ORIGINAL_CONFIG_PATH,
  SIDECAR_CONFIG_PATH,
  SIDECAR_STATE_PATH,
  buildDefaultConfig,
  buildDefaultState,
  buildCronFingerprint,
  createSidecarCronJob,
  disableCronJob,
  ensureSidecarHome,
  findOriginalCronJob,
  listCronJobs,
  loadOriginalConfig,
  loadSidecarConfig,
  loadSidecarState,
  log,
  nowIso,
  saveSidecarConfig,
  saveSidecarState
} from './sidecar-common.js';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    force: false,
    generationMode: null,
    webOutputDir: null,
    webSiteUrl: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--force':
        parsed.force = true;
        break;
      case '--generation-mode':
        parsed.generationMode = args[++index];
        break;
      case '--web-output-dir':
        parsed.webOutputDir = args[++index];
        break;
      case '--web-site-url':
        parsed.webSiteUrl = args[++index];
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function normalizeGenerationMode(value, fallback = 'script_model') {
  if (value === 'agent_native') return 'agent_native';
  if (value === 'script_model') return 'script_model';
  return fallback === 'agent_native' ? 'agent_native' : 'script_model';
}
async function main() {
  const args = parseArgs(process.argv);
  await ensureSidecarHome();

  const existingConfig = await loadSidecarConfig();
  const existingState = await loadSidecarState();
  const originalConfig = await loadOriginalConfig();
  const cronJobs = await listCronJobs();
  const originalJob = findOriginalCronJob(cronJobs, existingState.originalJobId);
  const existingSidecarJob = cronJobs.find((job) => job.id === existingState.sidecarJobId);

  if (!args.force && existingState.sidecarJobId && existingSidecarJob) {
    process.stdout.write(`${JSON.stringify({
      status: 'ok',
      message: 'Sidecar already initialized',
      configPath: SIDECAR_CONFIG_PATH,
      statePath: SIDECAR_STATE_PATH,
      sidecarJobId: existingState.sidecarJobId
    })}\n`);
    return;
  }

  const importedConfig = buildDefaultConfig({
    language: originalConfig?.language || existingConfig.language,
    timezone: originalConfig?.timezone || existingConfig.timezone,
    frequency: originalConfig?.frequency || existingConfig.frequency,
    weeklyDay: originalConfig?.weeklyDay || existingConfig.weeklyDay,
    model: existingConfig.model,
    generation: {
      mode: normalizeGenerationMode(args.generationMode, existingConfig.generation?.mode)
    },
    delivery: {
      targets: ['web'],
      web: {
        outputDir: args.webOutputDir || existingConfig.delivery?.web?.outputDir,
        siteUrl: args.webSiteUrl || existingConfig.delivery?.web?.siteUrl || null
      }
    },
    importedFrom: {
      originalConfigPath: originalConfig ? ORIGINAL_CONFIG_PATH : null,
      importedAt: nowIso()
    }
  });

  const nextState = buildDefaultState({
    originalJobId: originalJob?.id || existingState.originalJobId || null,
    lastOriginalCronFingerprint: buildCronFingerprint(originalJob)
  });

  if (originalJob?.enabled) {
    log('info', 'Disabling original follow-builders cron during takeover', {
      jobId: originalJob.id
    });
    await disableCronJob(originalJob.id);
  }

  const sidecarJob = await createSidecarCronJob({
    timeZone: importedConfig.timezone,
    generationMode: importedConfig.generation?.mode,
    model: importedConfig.generation?.mode === 'agent_native' ? importedConfig.model : null
  });
  nextState.sidecarJobId = sidecarJob.id;

  await saveSidecarConfig(importedConfig);
  await saveSidecarState(nextState);

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    configPath: SIDECAR_CONFIG_PATH,
    statePath: SIDECAR_STATE_PATH,
    originalJobId: originalJob?.id || null,
    sidecarJobId: sidecarJob.id,
    disabledOriginalJob: Boolean(originalJob?.enabled)
  })}\n`);
}

const IS_ENTRYPOINT = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (IS_ENTRYPOINT) {
  main().catch((error) => {
    log('error', 'Sidecar setup failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}
