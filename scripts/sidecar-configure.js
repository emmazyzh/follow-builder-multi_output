#!/usr/bin/env node

import { join } from 'path';
import { fileURLToPath } from 'url';

import {
  SCRIPT_DIR,
  buildDefaultConfig,
  buildSidecarCronMessage,
  loadSidecarConfig,
  loadSidecarState,
  log,
  normalizeDeliveryTargets,
  normalizeWeeklyDay,
  runOpenClaw,
  saveSidecarConfig
} from './sidecar-common.js';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--language':
        parsed.language = args[++index];
        break;
      case '--timezone':
        parsed.timezone = args[++index];
        break;
      case '--frequency':
        parsed.frequency = args[++index];
        break;
      case '--weekly-day':
        parsed.weeklyDay = args[++index];
        break;
      case '--model':
        parsed.model = args[++index];
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

function validateWebConfig(config) {
  const targets = normalizeDeliveryTargets(config.delivery?.targets);
  if (!targets.includes('web')) {
    throw new Error('Web delivery must include the web target');
  }
  if (!config.delivery?.web?.outputDir) {
    throw new Error('Web delivery requires --web-output-dir or delivery.web.outputDir');
  }
}

function normalizeGenerationMode(value, fallback = 'script_model') {
  if (value === 'agent_native') return 'agent_native';
  if (value === 'script_model') return 'script_model';
  return fallback === 'agent_native' ? 'agent_native' : 'script_model';
}

async function syncSidecarCronJob(config) {
  const state = await loadSidecarState();
  if (!state.sidecarJobId) return null;

  const scriptPath = join(SCRIPT_DIR, 'run-sidecar.js');
  const message = buildSidecarCronMessage(scriptPath, {
    generationMode: config.generation?.mode
  });
  const args = [
    'cron',
    'edit',
    state.sidecarJobId,
    '--message',
    message,
    '--timeout-seconds',
    '900'
  ];
  if (config.generation?.mode === 'agent_native' && config.model) {
    args.push('--model', config.model);
  }
  await runOpenClaw(args);
  return state.sidecarJobId;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = await loadSidecarConfig();

  const nextConfig = buildDefaultConfig({
    ...config,
    ...(args.language ? { language: args.language } : {}),
    ...(args.timezone ? { timezone: args.timezone } : {}),
    ...(args.frequency ? { frequency: args.frequency } : {}),
    ...(args.weeklyDay ? { weeklyDay: normalizeWeeklyDay(args.weeklyDay) } : {}),
    ...(args.model ? { model: args.model } : {}),
    generation: {
      ...config.generation,
      ...(args.generationMode ? { mode: normalizeGenerationMode(args.generationMode, config.generation?.mode) } : {})
    },
    delivery: {
      ...config.delivery,
      targets: ['web'],
      web: {
        ...config.delivery.web,
        ...(args.webOutputDir ? { outputDir: args.webOutputDir } : {}),
        ...(args.webSiteUrl ? { siteUrl: args.webSiteUrl } : {})
      }
    }
  });

  validateWebConfig(nextConfig);

  await saveSidecarConfig(nextConfig);

  const sidecarJobId = await syncSidecarCronJob(nextConfig);

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    config: nextConfig,
    sidecarJobId
  })}\n`);
}

const IS_ENTRYPOINT = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (IS_ENTRYPOINT) {
  main().catch((error) => {
    log('error', 'Sidecar configure failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}
