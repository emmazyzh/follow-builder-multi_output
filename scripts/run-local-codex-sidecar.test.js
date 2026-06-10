import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPreferredXEnglishBody } from './run-local-codex-sidecar.js';

test('buildPreferredXEnglishBody puts quoted tweet text before the user comment', () => {
  const result = buildPreferredXEnglishBody({
    text: 'That gap probably shrinks in the next few months! https://t.co/R7L8TDFuvC',
    quotedTweet: {
      text: 'Autonomous startups are everywhere, but the last mile still bites'
    }
  });

  assert.equal(
    result,
    [
      'Autonomous startups are everywhere, but the last mile still bites',
      'That gap probably shrinks in the next few months! https://t.co/R7L8TDFuvC'
    ].join('\n\n')
  );
});

test('buildPreferredXEnglishBody ignores quoted tweets that are only links', () => {
  const result = buildPreferredXEnglishBody({
    text: 'Useful comment here',
    quotedTweet: {
      text: 'https://t.co/abc123'
    }
  });

  assert.equal(result, 'Useful comment here');
});
