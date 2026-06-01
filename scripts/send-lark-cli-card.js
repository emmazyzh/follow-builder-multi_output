#!/usr/bin/env node

import { execFile } from 'child_process';
import { promisify } from 'util';

import {
  detectReceiveIdType,
  parseArgs,
  readStructuredInput,
  writeCardJson
} from './feishu-card-local.js';
import {
  buildCard,
  validatePayload
} from './send-feishu-card.js';

const execFileAsync = promisify(execFile);

function log(level, message, context = {}) {
  const payload = { level, message };
  if (Object.keys(context).length > 0) {
    payload.context = context;
  }
  console.error(JSON.stringify(payload));
}

async function sendCardWithLarkCli(card, target, { as = 'user', receiveIdType = null } = {}) {
  const resolvedReceiveIdType = receiveIdType || detectReceiveIdType(target);
  if (resolvedReceiveIdType !== 'chat_id') {
    throw new Error('lark-cli card delivery currently supports group chat IDs only (oc_xxx)');
  }

  const content = JSON.stringify(card);
  const { stdout } = await execFileAsync('lark-cli', [
    'im',
    '+messages-send',
    '--as',
    as,
    '--chat-id',
    target,
    '--msg-type',
    'interactive',
    '--content',
    content
  ], {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180000
  });

  return stdout.trim() ? JSON.parse(stdout.trim()) : { status: 'ok' };
}

async function main() {
  const args = parseArgs(process.argv);
  const as = process.env.FOLLOW_BUILDERS_LARK_CLI_AS || 'user';
  log('info', 'lark-cli Feishu card sender started', {
    file: args.file || 'stdin',
    dryRun: Boolean(args.dryRunFile || args.printCard),
    as
  });

  const payload = await readStructuredInput(args.file);
  validatePayload(payload);
  const card = buildCard(payload, new Map());

  if (args.dryRunFile) {
    await writeCardJson(args.dryRunFile, card);
    log('info', 'Card JSON written to dry-run file', { path: args.dryRunFile });
  }

  if (args.printCard) {
    process.stdout.write(`${JSON.stringify(card, null, 2)}\n`);
  }

  if (args.dryRunFile || args.printCard) {
    return;
  }

  if (!args.to) {
    throw new Error('Missing required argument: --to');
  }

  const result = await sendCardWithLarkCli(card, args.to, {
    as,
    receiveIdType: args.receiveIdType
  });
  process.stdout.write(`${JSON.stringify({ status: 'ok', result })}\n`);
}

main().catch((error) => {
  log('error', 'lark-cli Feishu card sender failed', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});
