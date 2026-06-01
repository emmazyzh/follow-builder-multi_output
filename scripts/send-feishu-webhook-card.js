#!/usr/bin/env node

import {
  cropAvatarToCircle,
  parseArgs,
  readStructuredInput,
  withAvatarTempDir,
  writeCardJson
} from './feishu-card-local.js';
import {
  buildCard,
  validatePayload
} from './send-feishu-card.js';
import { fetchAvatarBuffer } from './feishu-card-api.js';
import { execFile } from 'child_process';
import { basename, join } from 'path';
import { promisify } from 'util';
import { writeFile } from 'fs/promises';

const execFileAsync = promisify(execFile);
const MAX_ITEMS_PER_CARD = 6;

function log(level, message, context = {}) {
  const payload = { level, message };
  if (Object.keys(context).length > 0) {
    payload.context = context;
  }
  console.error(JSON.stringify(payload));
}

async function postWebhookCard(url, card) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      msg_type: 'interactive',
      card
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Webhook request failed with status ${response.status}: ${payload ? JSON.stringify(payload) : 'empty response'}`);
  }

  if (payload && typeof payload.code !== 'undefined' && payload.code !== 0) {
    throw new Error(`Webhook send failed: ${payload.msg || JSON.stringify(payload)}`);
  }

  return payload || { code: 0 };
}

async function uploadAvatarWithLarkCliBot(buffer, tempDir) {
  const filename = `avatar-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
  const filepath = join(tempDir, filename);
  await writeFile(filepath, buffer);

  const { stdout } = await execFileAsync('lark-cli', [
    'im',
    'images',
    'create',
    '--as',
    'bot',
    '--data',
    '{"image_type":"message"}',
    '--file',
    basename(filepath)
  ], {
    cwd: tempDir,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180000
  });

  const payload = stdout.trim() ? JSON.parse(stdout.trim()) : null;
  const imageKey = payload?.data?.image_key || payload?.image_key || null;
  if (!imageKey) {
    throw new Error(`Image upload did not return image_key: ${stdout.trim()}`);
  }
  return imageKey;
}

async function resolveAvatarKeys(items) {
  const avatarKeys = new Map();
  return withAvatarTempDir(async (tempDir) => {
    for (const item of items) {
      const itemKey = item.profile_url || item.source_url || item.person_handle || item.name;
      if (!itemKey) continue;
      try {
        const originalBuffer = await fetchAvatarBuffer(item, log);
        if (!originalBuffer) continue;
        let uploadBuffer = originalBuffer;
        try {
          uploadBuffer = await cropAvatarToCircle(originalBuffer, tempDir);
        } catch (error) {
          log('warning', 'Avatar crop failed, falling back to original image', {
            person: item.person_name || item.name || 'unknown',
            itemKey,
            error: error.message
          });
        }
        const imageKey = await uploadAvatarWithLarkCliBot(uploadBuffer, tempDir);
        avatarKeys.set(itemKey, imageKey);
      } catch (error) {
        log('warning', 'Avatar upload skipped for webhook card item', {
          person: item.person_name || item.name || 'unknown',
          itemKey,
          error: error.message
        });
      }
    }
    return avatarKeys;
  });
}

function chunkItems(items, size = MAX_ITEMS_PER_CARD) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildChunkPayloads(payload, size = MAX_ITEMS_PER_CARD) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const chunks = chunkItems(items, size);
  if (chunks.length <= 1) {
    return [payload];
  }

  return chunks.map((chunk, index) => ({
    ...payload,
    title: `${payload.title} (${index + 1}/${chunks.length})`,
    summary: index === 0 ? payload.summary : '',
    items: chunk
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  const webhookUrl = process.env.FOLLOW_BUILDERS_FEISHU_WEBHOOK_URL || '';
  if (!webhookUrl) {
    throw new Error('Missing FOLLOW_BUILDERS_FEISHU_WEBHOOK_URL');
  }

  log('info', 'Feishu webhook card sender started', {
    file: args.file || 'stdin',
    dryRun: Boolean(args.dryRunFile || args.printCard)
  });

  const payload = await readStructuredInput(args.file);
  validatePayload(payload);
  const avatarKeys = await resolveAvatarKeys(Array.isArray(payload.items) ? payload.items : []);
  const payloadChunks = buildChunkPayloads(payload);
  const cards = payloadChunks.map((chunk) => buildCard(chunk, avatarKeys));

  if (args.dryRunFile) {
    await writeCardJson(args.dryRunFile, cards.length === 1 ? cards[0] : cards);
    log('info', 'Card JSON written to dry-run file', { path: args.dryRunFile, cards: cards.length });
  }

  if (args.printCard) {
    process.stdout.write(`${JSON.stringify(cards.length === 1 ? cards[0] : cards, null, 2)}\n`);
  }

  if (args.dryRunFile || args.printCard) {
    return;
  }

  const results = [];
  for (const card of cards) {
    results.push(await postWebhookCard(webhookUrl, card));
  }
  process.stdout.write(`${JSON.stringify({ status: 'ok', cards: results.length, results })}\n`);
}

main().catch((error) => {
  log('error', 'Feishu webhook card sender failed', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});
