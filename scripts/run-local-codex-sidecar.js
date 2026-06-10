#!/usr/bin/env node

import { execFile } from 'child_process';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { fileURLToPath, pathToFileURL } from 'url';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(SCRIPT_DIR, '..');
const RUNTIME_DIR = join(REPO_DIR, '.runtime', 'local-runner');
const RAW_PATH = join(RUNTIME_DIR, 'latest-raw.json');
const PAYLOAD_PATH = join(RUNTIME_DIR, 'latest-payload.json');
const RESULT_PATH = join(RUNTIME_DIR, 'last-result.json');
const PROMPT_PATH = join(RUNTIME_DIR, 'latest-prompt.txt');
const RUN_LOCK_DIR = join(RUNTIME_DIR, 'run.lock');
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
const FULL_PAYLOAD_ATTEMPTS = 1;
const SEGMENT_ATTEMPTS = 3;

function buildRunId() {
  return `local-runner-${new Date().toISOString()}-pid-${process.pid}`;
}

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

async function acquireRunLock() {
  try {
    await mkdir(RUN_LOCK_DIR);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error('Local Codex sidecar runner is already in progress');
    }
    throw error;
  }
}

async function releaseRunLock() {
  await rm(RUN_LOCK_DIR, { recursive: true, force: true });
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

function buildInlineCodexPrompt(rawJson, payloadPath, expectedItemCount, options = {}) {
  const extraStrict = options.extraStrict === true;
  const retryReason = String(options.retryReason || '').trim();
  return [
    'You are given a prepared digest snapshot JSON below.',
    'Return pure JSON only in your final response, with no markdown fences and no explanation.',
    ...(extraStrict ? [
      'CRITICAL: your response must start with { as the very first character and end with } as the final character.',
      'CRITICAL: do not write any preface, note, apology, quote, commentary, or trailing text before or after the JSON.',
      `CRITICAL: the items array must contain exactly ${expectedItemCount} items. An empty items array is invalid.`
    ] : []),
    ...(retryReason ? [
      `Previous attempt failed for this reason: ${retryReason}`,
      'Fix that exact failure in this attempt.'
    ] : []),
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
    'For X / Twitter quote tweets: when quotedTweet text contains the main information, show the quotedTweet text first and the user comment text after it. Do not leave the quoted content hidden behind only a t.co link.',
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

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasReadableText(value) {
  return Boolean(collapseWhitespace(value).replace(/https?:\/\/\S+/g, '').trim());
}

function buildPreferredXEnglishBody(tweet) {
  const parts = [];
  const quotedText = collapseWhitespace(tweet?.quotedTweet?.text || '');
  const tweetText = String(tweet?.text || '').trim();
  if (hasReadableText(quotedText)) parts.push(quotedText);
  if (tweetText) parts.push(tweetText);
  return parts.join('\n\n');
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

async function generatePayloadWithCodex(expectedItemCount, options = {}) {
  const attempt = Number.isInteger(options.attempt) ? options.attempt : 0;
  const attemptPayloadPath = join(RUNTIME_DIR, `latest-payload.pid-${process.pid}.attempt-${attempt + 1}.json`);
  const raw = JSON.parse(await readFile(RAW_PATH, 'utf-8'));
  const prompt = buildInlineCodexPrompt(
    JSON.stringify(buildCodexInput(raw), null, 2),
    attemptPayloadPath,
    expectedItemCount,
    options
  );
  await runCodexPrompt(prompt, attemptPayloadPath);
  return attemptPayloadPath;
}

async function runCodexPrompt(prompt, outputPath) {
  await writeFile(PROMPT_PATH, `${prompt}\n`);
  await execFileAsync('/bin/zsh', [
    '-lc',
    `"${CODEX_BIN}" exec --skip-git-repo-check --sandbox read-only --cd "${REPO_DIR}" --output-last-message "${outputPath}" - < "${PROMPT_PATH}"`
  ], {
    cwd: REPO_DIR,
    env: runnerEnv(),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30 * 60 * 1000
  });
}

function stripMarkdownFence(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Generated payload is empty');
  }

  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  return trimmed;
}

function extractJsonCandidates(text) {
  const normalized = stripMarkdownFence(text);
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(normalized.slice(start, index + 1));
        start = -1;
      }
    }
  }

  if (candidates.length > 0) {
    return candidates;
  }

  return [normalized];
}

function parsePayloadText(text, expectedItemCount) {
  const candidates = extractJsonCandidates(text);
  const parsedCandidates = [];

  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(candidate);
      const itemCount = Array.isArray(payload?.items) ? payload.items.length : 0;
      if (itemCount === expectedItemCount) {
        return payload;
      }
      parsedCandidates.push({
        payload,
        itemCount
      });
    } catch {
      // keep scanning other candidates
    }
  }

  if (parsedCandidates.length > 0) {
    parsedCandidates.sort((left, right) => right.itemCount - left.itemCount);
    return parsedCandidates[0].payload;
  }

  return JSON.parse(candidates[0]);
}

async function writeCanonicalPayload(payload) {
  const tempPath = `${PAYLOAD_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(tempPath, PAYLOAD_PATH);
}

function parseJsonObjectByPredicate(text, predicate, label) {
  const candidates = extractJsonCandidates(text);
  const parsedCandidates = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (predicate(parsed)) {
        return parsed;
      }
      parsedCandidates.push(parsed);
    } catch {
      // keep scanning
    }
  }
  if (parsedCandidates.length > 0) {
    throw new Error(`Generated ${label} JSON did not match the expected shape`);
  }
  throw new Error(`Generated ${label} output did not contain valid JSON`);
}

function isValidGeneratedItem(item) {
  return Boolean(
    item &&
    typeof item === 'object' &&
    typeof item.person_name === 'string' &&
    typeof item.person_identity === 'string' &&
    typeof item.source_label === 'string' &&
    typeof item.posted_at === 'string' &&
    Array.isArray(item.sections) &&
    item.sections.length > 0 &&
    item.sections.every((section) => (
      section &&
      typeof section.headline === 'string' &&
      typeof section.body === 'string' &&
      Array.isArray(section.source_links)
    ))
  );
}

function buildContentDate(prepareResult, raw) {
  const scheduleKey = String(prepareResult?.scheduleKey || '');
  const keyedDate = scheduleKey.startsWith('daily:') ? scheduleKey.slice('daily:'.length) : '';
  if (keyedDate) return keyedDate;
  const generatedAt = String(raw?.generatedAt || '').slice(0, 10);
  if (generatedAt) return generatedAt;
  return new Date().toISOString().slice(0, 10);
}

function buildSummaryPrompt(rawJson, contentDate) {
  return [
    'You are given a prepared digest snapshot JSON below.',
    'Return pure JSON only, with no markdown fences and no explanation.',
    'The root shape must be exactly: { "summary": "..." }.',
    'Write a bilingual summary with English first and Chinese second.',
    'The summary is not exhaustive. It should feel like a punchy, high-signal news board with breakout moments and strong hooks.',
    'Use two short paragraphs only: first English, then Chinese. In each paragraph, use 2-4 short semicolon-separated headline-style bullets.',
    'Bold the most important phrases with markdown **bold** when helpful.',
    'For the Chinese summary, explicitly follow humanizer rules: remove AI-writing tells, avoid vague trend filler, avoid corporate promo tone, keep it sharp and human.',
    `The digest date is ${contentDate}.`,
    '<feed_json>',
    rawJson,
    '</feed_json>'
  ].join('\n');
}

function buildItemPrompt(sourceKind, sourceJson) {
  return [
    'You are given one prepared digest source JSON below.',
    'Return pure JSON only, with no markdown fences and no explanation.',
    'The root shape must be exactly one item object with these keys: person_name, person_handle, person_identity, profile_url, source_label, posted_at, sections.',
    'sections must be a non-empty array of objects, each with headline, body, source_links.',
    'Keep person_identity concise and familiar, like "Box CEO", "OpenAI Product", or "AI Podcast".',
    ...(sourceKind === 'x'
      ? [
        'This is an X / Twitter source.',
        'Do not summarize the body. Use the original post text directly, then provide a faithful Chinese translation immediately below it in the same body string.',
        'If a tweet includes quotedTweet text and that quoted text carries the main information, show the quotedTweet text first and the user comment after it. Do not leave the quote as only a link.',
        'Write a short one-line bilingual headline with English first and Chinese second.',
        'Do not use labels like "Original Post · 原文".'
      ]
      : [
        `This is a ${sourceKind === 'podcast' ? 'podcast' : 'blog'} source.`,
        'Summarize it in bilingual form with English first and Chinese second.',
        'Each headline must be bilingual in one string, English first then Chinese.'
      ]),
    'Preserve paragraph breaks and original source links.',
    'Bold important proper nouns, company names, product names, and model names where natural.',
    'For all Chinese text, do a humanizer pass: remove AI-sounding filler and make it sound natural and sharp.',
    '<source_json>',
    sourceJson,
    '</source_json>'
  ].join('\n');
}

function buildXSectionPrompt(tweetJson) {
  return [
    'You are given one X / Twitter post JSON below.',
    'Return pure JSON only, with no markdown fences and no explanation.',
    'The root shape must be exactly: { "headline": "...", "body": "..." }.',
    'Do not summarize the body. Use the original post text directly, then provide a faithful Chinese translation immediately below it in the same body string.',
    'If quotedTweet text is present and carries the main information, the body must show that quotedTweet text first, then the user comment text after it. Do not leave the quoted content as only a t.co link.',
    'Write a short one-line bilingual headline with English first and Chinese second.',
    'Do not use labels like "Original Post · 原文".',
    'Preserve paragraph breaks.',
    'Bold important proper nouns, company names, product names, and model names where natural.',
    'For the Chinese text, do a humanizer pass: remove AI-sounding filler and keep it natural and sharp.',
    '<tweet_json>',
    tweetJson,
    '</tweet_json>'
  ].join('\n');
}

function deriveFallbackIdentity(entry) {
  const bio = String(entry?.bio || '').trim();
  if (!bio) return 'X / Twitter';
  const firstLine = bio.split('\n')[0].trim();
  return firstLine.slice(0, 80);
}

function firstNonEmptyLine(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function truncateText(text, maxChars) {
  const value = String(text || '').trim();
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

async function readAttemptOutputs(outputStem) {
  const prefix = `${outputStem}.attempt-`;
  const filenames = (await readdir(RUNTIME_DIR))
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort();
  const outputs = [];
  for (const filename of filenames) {
    const fullPath = join(RUNTIME_DIR, filename);
    outputs.push({
      path: fullPath,
      text: await readFile(fullPath, 'utf-8')
    });
  }
  return outputs;
}

function extractChineseTail(text) {
  const value = String(text || '');
  const start = value.search(/[\u3400-\u9fff]/);
  if (start < 0) return '';
  return value.slice(start).replace(/^[^一-龥]*?/, '').trim();
}

async function salvageXSectionFallback(tweet, outputStem) {
  const outputs = await readAttemptOutputs(outputStem);
  const richest = outputs
    .map((entry) => ({
      ...entry,
      chineseTail: extractChineseTail(entry.text)
    }))
    .sort((left, right) => right.chineseTail.length - left.chineseTail.length)[0];

  const englishHeadline = truncateText(firstNonEmptyLine(tweet.text), 72);
  const chineseHeadline = truncateText(firstNonEmptyLine(richest?.chineseTail || ''), 28);
  const headline = chineseHeadline
    ? `${englishHeadline} · ${chineseHeadline}`
    : `${englishHeadline} · ${englishHeadline}`;

  const preferredBody = buildPreferredXEnglishBody(tweet);
  const bodyParts = [preferredBody];
  if (richest?.chineseTail) {
    bodyParts.push(richest.chineseTail);
  } else {
    bodyParts.push(preferredBody);
  }

  return {
    headline,
    body: bodyParts.filter(Boolean).join('\n\n')
  };
}

async function generateJsonSegment({ label, predicate, promptBuilder, outputStem }) {
  let lastError = null;
  for (let attempt = 0; attempt < SEGMENT_ATTEMPTS; attempt += 1) {
    const outputPath = join(RUNTIME_DIR, `${outputStem}.attempt-${attempt + 1}.json`);
    try {
      const prompt = promptBuilder(attempt, lastError);
      await runCodexPrompt(prompt, outputPath);
      const outputText = await readFile(outputPath, 'utf-8');
      return parseJsonObjectByPredicate(outputText, predicate, label);
    } catch (error) {
      lastError = error;
      log('warning', `Generated ${label} validation failed`, {
        attempt: attempt + 1,
        error: error.message
      });
    }
  }
  throw lastError || new Error(`Failed to generate ${label}`);
}

async function generateXItemFallback(entry, index) {
  log('warning', 'Falling back to per-tweet generation for X item', {
    index: index + 1,
    handle: entry.handle
  });

  const sections = [];
  for (let tweetIndex = 0; tweetIndex < entry.data.tweets.length; tweetIndex += 1) {
    const tweet = entry.data.tweets[tweetIndex];
    const outputStem = `latest-x-section.pid-${process.pid}.${index + 1}.${tweetIndex + 1}`;
    let section;
    try {
      section = await generateJsonSegment({
        label: `x item ${index + 1} section ${tweetIndex + 1}`,
        predicate: (value) => value && typeof value.headline === 'string' && typeof value.body === 'string',
        outputStem,
        promptBuilder: (_attempt, lastError) => [
          buildXSectionPrompt(JSON.stringify(tweet, null, 2)),
          ...(lastError
            ? [
              '',
              `Previous attempt failed for this reason: ${lastError.message}`,
              'Fix that exact failure. Return only one valid JSON object.'
            ]
            : [])
        ].join('\n')
      });
    } catch (error) {
      log('warning', 'Falling back to salvaged X section output', {
        index: index + 1,
        tweetIndex: tweetIndex + 1,
        error: error.message
      });
      section = await salvageXSectionFallback(tweet, outputStem);
    }
    sections.push({
      headline: section.headline,
      body: section.body,
      source_links: [
        ...(tweet.url ? [tweet.url] : []),
        ...(tweet.quotedTweet?.url ? [tweet.quotedTweet.url] : [])
      ]
    });
  }

  return {
    person_name: entry.data.name,
    person_handle: entry.data.handle || '',
    person_identity: deriveFallbackIdentity(entry.data),
    profile_url: entry.data.handle ? `https://x.com/${entry.data.handle}` : '',
    source_label: 'X / Twitter',
    posted_at: entry.data.tweets[0]?.createdAt || new Date().toISOString(),
    sections
  };
}

async function generateSegmentedPayload(raw, prepareResult) {
  const codexInput = buildCodexInput(raw);
  const contentDate = buildContentDate(prepareResult, raw);

  const summaryObject = await generateJsonSegment({
    label: 'summary',
    predicate: (value) => value && typeof value.summary === 'string' && value.summary.trim().length > 0,
    outputStem: `latest-summary.pid-${process.pid}`,
    promptBuilder: (_attempt, lastError) => [
      buildSummaryPrompt(JSON.stringify(codexInput, null, 2), contentDate),
      ...(lastError
        ? [
          '',
          `Previous attempt failed for this reason: ${lastError.message}`,
          'Fix that exact failure. Return only one valid JSON object.'
        ]
        : [])
    ].join('\n')
  });

  const entries = [
    ...codexInput.x.map((entry) => ({ kind: 'x', data: entry })),
    ...codexInput.podcasts.map((entry) => ({ kind: 'podcast', data: entry })),
    ...codexInput.blogs.map((entry) => ({ kind: 'blog', data: entry }))
  ];

  const items = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    let item;
    if (entry.kind === 'x') {
      item = await generateXItemFallback(entry, index);
    } else {
      item = await generateJsonSegment({
        label: `item ${index + 1}`,
        predicate: isValidGeneratedItem,
        outputStem: `latest-item.pid-${process.pid}.${index + 1}`,
        promptBuilder: (_attempt, lastError) => [
          buildItemPrompt(entry.kind, JSON.stringify(entry.data, null, 2)),
          ...(lastError
            ? [
              '',
              `Previous attempt failed for this reason: ${lastError.message}`,
              'Fix that exact failure. Return only one valid JSON object for exactly one item.'
            ]
            : [])
        ].join('\n')
      });
    }
    items.push(item);
  }

  const payload = {
    date: contentDate,
    title: `AI Builders Daily · ${contentDate}`,
    summary: summaryObject.summary,
    items
  };
  await writeCanonicalPayload(payload);
  return payload;
}

async function validatePayload(raw, payloadPath) {
  const payloadText = await readFile(payloadPath, 'utf-8');
  const expected = countSources(raw);
  const payload = parsePayloadText(payloadText, expected);
  const actual = Array.isArray(payload?.items) ? payload.items.length : 0;
  if (actual !== expected) {
    throw new Error(`Generated payload item count mismatch: expected ${expected}, got ${actual}`);
  }
  await writeCanonicalPayload(payload);
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
  const runId = buildRunId();
  const startedAt = new Date().toISOString();
  await ensureRuntimeDir();
  await acquireRunLock();

  try {
    await persistResult({
      status: 'in_progress',
      stage: 'startup',
      runId,
      startedAt,
      dryRun: args.dryRun,
      force: args.force
    });

    log('info', 'Local Codex sidecar runner started', {
      runId,
      startedAt,
      force: args.force,
      dryRun: args.dryRun
    });

    const prepareResult = await prepareSnapshot(args.force);
    if (prepareResult.status === 'skipped') {
      const skipped = {
        status: 'skipped',
        stage: 'prepare',
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
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

    let lastValidationError = null;
    let attempt = 0;
    while (attempt < FULL_PAYLOAD_ATTEMPTS) {
      const isRetry = attempt > 0;
      const attemptPayloadPath = await generatePayloadWithCodex(expectedItemCount, {
        attempt,
        extraStrict: isRetry,
        retryReason: lastValidationError?.message || ''
      });
      try {
        await validatePayload(raw, attemptPayloadPath);
        lastValidationError = null;
        break;
      } catch (error) {
        lastValidationError = error;
        log('warning', 'Generated payload validation failed', {
          attempt: attempt + 1,
          error: error.message
        });
        attempt += 1;
      }
    }
    if (lastValidationError) {
      log('warning', 'Falling back to segmented payload generation after repeated full-payload failures', {
        error: lastValidationError.message
      });
      await generateSegmentedPayload(raw, prepareResult);
    }
    const deliveryResult = await deliverPayload(args.dryRun);

    const finalResult = {
      status: 'ok',
      stage: 'delivery',
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      dryRun: args.dryRun,
      prepare: prepareResult,
      delivery: deliveryResult
    };
    await persistResult(finalResult);
    process.stdout.write(`${JSON.stringify(finalResult)}\n`);
  } finally {
    await releaseRunLock();
  }
}

const isMainModule = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isMainModule) {
  main().catch(async (error) => {
    const result = {
      status: 'error',
      runId: `local-runner-failed-before-main-pid-${process.pid}`,
      finishedAt: new Date().toISOString(),
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
}

export {
  buildPreferredXEnglishBody
};
