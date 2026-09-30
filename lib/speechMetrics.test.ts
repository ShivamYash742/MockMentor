import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countFillerWords, computeSpeechMetrics } from './speechMetrics.ts';

test('countFillerWords matches the multi-word phrase "you know"', () => {
  assert.equal(countFillerWords("you know, I think it's, you know, fine"), 2);
});

test('countFillerWords matches single-word fillers as whole words only', () => {
  assert.equal(countFillerWords('um so uh it basically worked'), 3);
  assert.equal(countFillerWords('unlike anything else'), 0); // "like" must not match inside "unlike"
});

test('countFillerWords counts "like" only as hesitation, not as a verb or comparison', () => {
  assert.equal(countFillerWords('I like Python and I would like to learn Go'), 0);
  assert.equal(countFillerWords("It looks like a cache issue and I'd like to fix it"), 0);
  assert.equal(countFillerWords('it was like really hard and like we had to like rewrite it'), 3);
});

test('computeSpeechMetrics derives real speaking time from durationMs, not a 50/50 split', () => {
  const metrics = computeSpeechMetrics(
    [
      { content: 'I have five years of experience', durationMs: 4000, pauseBefore: 1000 },
      { content: 'building web applications', durationMs: 2000, pauseBefore: 500 },
    ],
    20000
  );
  assert.equal(metrics.userSpeakingTime, 6000);
  assert.equal(metrics.interviewerSpeakingTime, 14000);
  assert.equal(metrics.totalPauses, 2);
  assert.equal(metrics.averagePauseLength, 750);
  assert.equal(metrics.longestPause, 1000);
});

test('computeSpeechMetrics uses only spoken answers for pace and fillers', () => {
  const metrics = computeSpeechMetrics(
    [
      { content: 'one two three four five six', durationMs: 3000 }, // 6 words in 3s = 120 wpm
      { content: 'um a long typed answer with many many words um basically' }, // typed: no duration
    ],
    60000
  );
  assert.equal(metrics.wordsPerMinute, 120);
  assert.equal(metrics.fillerWordsCount, 0);
});

test('computeSpeechMetrics ignores missing timing data instead of fabricating it', () => {
  const metrics = computeSpeechMetrics([{ content: 'hello there' }], 10000);
  assert.equal(metrics.userSpeakingTime, 0);
  assert.equal(metrics.totalPauses, 0);
  assert.equal(metrics.longestPause, 0);
  assert.equal(metrics.wordsPerMinute, 0); // can't compute WPM with zero speaking time
});

test('computeSpeechMetrics handles no messages at all', () => {
  const metrics = computeSpeechMetrics([], 5000);
  assert.equal(metrics.userSpeakingTime, 0);
  assert.equal(metrics.interviewerSpeakingTime, 5000);
  assert.equal(metrics.fillerWordsCount, 0);
});
