#!/usr/bin/env node

import { execFile } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(SCRIPT_DIR, '..');
const RUNTIME_DIR = join(REPO_DIR, '.runtime', 'local-runner');
const RAW_PATH = join(RUNTIME_DIR, 'latest-raw.json');
const PAYLOAD_PATH = join(RUNTIME_DIR, 'latest-payload.json');
const RESULT_PATH = join(RUNTIME_DIR, 'last-result.json');
const PROMPT_PATH = join(RUNTIME_DIR, 'latest-prompt.txt');
const NODE_BIN = process.execPath;
const NODE_BIN_DIR = dirname(NODE_BIN);
const CODEX_BIN = process.env.FOLLOW_BUILDERS_CODEX_BIN || 'codex';
const PATH_PREFIX = [
  NODE_BIN_DIR,
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin'
].join(':');
const MAX_PODCAST_TRANSCRIPT_CHARS = 12000;
const MAX_BLOG_CONTENT_CHARS = 8000;

function log(level, message, context = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message
  };
  if (Object.keys(context).length > 0) {
    payload.context = context;
  }
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    force: args.includes('--force'),
    dryRun: args.includes('--dry-run')
  };
}

function runnerEnv() {
  return {
    ...process.env,
    PATH: `${PATH_PREFIX}:${process.env.PATH || ''}`.replace(/:+/g, ':')
  };
}

async function ensureRuntimeDir() {
  await mkdir(RUNTIME_DIR, { recursive: true });
}

async function runNodeScript(scriptName, args = []) {
  const { stdout } = await execFileAsync(NODE_BIN, [join(SCRIPT_DIR, scriptName), ...args], {
    cwd: REPO_DIR,
    env: runnerEnv(),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 20 * 60 * 1000
  });
  return stdout.trim();
}

async function prepareSnapshot(force) {
  const args = [];
  if (force) args.push('--force');
  args.push('--prepare-only', '--input-json-out', RAW_PATH, '--payload-out', PAYLOAD_PATH);
  const stdout = await runNodeScript('run-sidecar.js', args);
  return JSON.parse(stdout);
}

function countSources(raw) {
  return (raw?.x?.length || 0) + (raw?.podcasts?.length || 0) + (raw?.blogs?.length || 0);
}

function buildCodexPrompt(rawPath, payloadPath, expectedItemCount) {
  throw new Error('buildCodexPrompt(rawPath, payloadPath, expectedItemCount) is deprecated');
}

function buildInlineCodexPrompt(rawJson, payloadPath, expectedItemCount) {
  return [
    'You are given a prepared digest snapshot JSON below.',
    'Return pure JSON only in your final response, with no markdown fences and no explanation.',
    'The root shape must be exactly: { "date": "YYYY-MM-DD", "title": "AI Builders Daily · YYYY-MM-DD", "summary": "...", "items": [...] }.',
    'The summary must be bilingual with English first and Chinese second.',
    'The summary is not meant to be exhaustive. It should read like a punchy news overview with strong hooks, big developments, and high-signal takeaways.',
    'Write the summary as two parallel single-paragraph blocks: one English block, then one Chinese block. In each block, use 2-4 short semicolon-separated headline-style bullets rather than a dense recap.',
    'Use vivid, energetic language. Prefer concrete headlines, breakout moments, surprises, launches, clashes, and notable claims over inventory-style coverage.',
    'Bold the most important phrases or sentences with markdown **bold** when it helps the eye land on the key news.',
    'For the Chinese summary specifically, apply the humanizer skill rules explicitly: remove AI-writing tells, avoid inflated significance, avoid vague trend language, avoid promotional filler, avoid symmetrical outline-like phrasing, vary rhythm, keep some edge and personality, and preserve concrete meaning.',
    'The Chinese summary should feel like a sharp human-written news note, not a neutral model recap or a polished corporate explainer.',
    `Strict full coverage is required: output exactly ${expectedItemCount} items, one for every source present in the snapshot.`,
    'Do not select a subset, do not omit weaker items, and do not merge different sources into one item.',
    'Each item must include person_name, person_handle when available, person_identity, profile_url, source_label, posted_at, and sections.',
    'Each section must include headline, body, and source_links.',
    'Keep person_identity concise and familiar, in the style of short role labels such as "Box CEO", "OpenAI Product", or "AI Podcast".',
    'For X / Twitter items: do not summarize the body. Use the original post text from the JSON directly, then provide a Chinese translation immediately below it in the same body string. Keep the meaning faithful and do not compress, paraphrase, or add commentary.',
    'For X / Twitter items: write a short one-line bilingual headline that restates the core point of the post, English first and Chinese second. Do not use labels like "Original Post · 原文".',
    'For blog and podcast items: keep the current summary flow. Write a bilingual summary with English first and Chinese second. These are the only item types that should be summarized.',
    'Each headline must be bilingual in a single string, English first then Chinese.',
    'Each body must preserve paragraph breaks. Start each paragraph on a new line, and leave a blank line between the English paragraph and the Chinese paragraph that follows it.',
    'Bold important proper nouns, company names, product names, and model names with markdown **bold** in both headlines and bodies where natural.',
    'Preserve the original URLs in source_links.',
    'For all Chinese text, do a humanizer pass: remove AI-sounding filler, avoid ceremonial significance inflation, avoid empty trend language, and make the Chinese sound natural and sharp.',
    'Ground everything in the snapshot only. No speculation. No browsing.',
    `The Codex CLI will save your final response to ${payloadPath}.`,
    '<feed_json>',
    rawJson,
    '</feed_json>'
  ].join('\n');
}

function trimText(value, maxChars) {
  const text = String(value || '');
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function buildCodexInput(raw) {
  return {
    generatedAt: raw?.generatedAt || null,
    stats: raw?.stats || {},
    podcasts: Array.isArray(raw?.podcasts)
      ? raw.podcasts.map((entry) => ({
        name: entry.name,
        title: entry.title,
        publishedAt: entry.publishedAt,
        url: entry.url,
        transcript: trimText(entry.transcript, MAX_PODCAST_TRANSCRIPT_CHARS)
      }))
      : [],
    blogs: Array.isArray(raw?.blogs)
      ? raw.blogs.map((entry) => ({
        name: entry.name,
        title: entry.title,
        publishedAt: entry.publishedAt,
        url: entry.url,
        description: entry.description || '',
        content: trimText(entry.content, MAX_BLOG_CONTENT_CHARS)
      }))
      : [],
    x: Array.isArray(raw?.x)
      ? raw.x.map((builder) => ({
        name: builder.name,
        handle: builder.handle,
        bio: builder.bio,
        tweets: Array.isArray(builder.tweets)
          ? builder.tweets.map((tweet) => ({
            text: tweet.text,
            url: tweet.url,
            createdAt: tweet.createdAt,
            quotedTweet: tweet.quotedTweet
              ? {
                text: tweet.quotedTweet.text,
                url: tweet.quotedTweet.url
              }
              : null
          }))
          : []
      }))
      : [],
    errors: Array.isArray(raw?.errors) ? raw.errors : []
  };
}

async function generatePayloadWithCodex(expectedItemCount) {
  const raw = JSON.parse(await readFile(RAW_PATH, 'utf-8'));
  const prompt = buildInlineCodexPrompt(
    JSON.stringify(buildCodexInput(raw), null, 2),
    PAYLOAD_PATH,
    expectedItemCount
  );
  await writeFile(PROMPT_PATH, `${prompt}\n`);
  await execFileAsync('/bin/zsh', [
    '-lc',
    `"${CODEX_BIN}" exec --skip-git-repo-check --sandbox read-only --cd "${REPO_DIR}" --output-last-message "${PAYLOAD_PATH}" - < "${PROMPT_PATH}"`
  ], {
    cwd: REPO_DIR,
    env: runnerEnv(),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30 * 60 * 1000
  });
}

async function validatePayload(raw) {
  const payload = JSON.parse(await readFile(PAYLOAD_PATH, 'utf-8'));
  const actual = Array.isArray(payload?.items) ? payload.items.length : 0;
  const expected = countSources(raw);
  if (actual !== expected) {
    throw new Error(`Generated payload item count mismatch: expected ${expected}, got ${actual}`);
  }
  return payload;
}

async function deliverPayload(dryRun) {
  const args = ['--input-json', RAW_PATH, '--payload', PAYLOAD_PATH];
  if (dryRun) args.push('--skip-delivery');
  const stdout = await runNodeScript('send-agent-payload.js', args);
  return JSON.parse(stdout);
}

async function persistResult(result) {
  await writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  await ensureRuntimeDir();

  log('info', 'Local Codex sidecar runner started', {
    force: args.force,
    dryRun: args.dryRun
  });

  const prepareResult = await prepareSnapshot(args.force);
  if (prepareResult.status === 'skipped') {
    const skipped = {
      status: 'skipped',
      stage: 'prepare',
      reason: prepareResult.reason,
      detail: prepareResult
    };
    await persistResult(skipped);
    process.stdout.write(`${JSON.stringify(skipped)}\n`);
    return;
  }

  if (prepareResult.status !== 'needs_payload') {
    throw new Error(`Unexpected prepare result: ${prepareResult.status || 'unknown'}`);
  }

  const raw = JSON.parse(await readFile(RAW_PATH, 'utf-8'));
  const expectedItemCount = countSources(raw);
  log('info', 'Prepared upstream snapshot for local runner', {
    expectedItemCount,
    rawPath: RAW_PATH
  });

  await generatePayloadWithCodex(expectedItemCount);
  await validatePayload(raw);
  const deliveryResult = await deliverPayload(args.dryRun);

  const finalResult = {
    status: 'ok',
    stage: 'delivery',
    dryRun: args.dryRun,
    prepare: prepareResult,
    delivery: deliveryResult
  };
  await persistResult(finalResult);
  process.stdout.write(`${JSON.stringify(finalResult)}\n`);
}

main().catch(async (error) => {
  const result = {
    status: 'error',
    message: error.message,
    stack: error.stack
  };
  try {
    await ensureRuntimeDir();
    await persistResult(result);
  } catch {
    // best effort only
  }
  log('error', 'Local Codex sidecar runner failed', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});
