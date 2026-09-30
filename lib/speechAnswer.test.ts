import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnswerAccumulator, type SpeechResultList } from './speechAnswer.ts';

// Builds an event's `results` the way Chrome does: every result of the session so far.
function results(...items: Array<[string, boolean]>): SpeechResultList {
  return items.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
}

test('one phrase: interim then final is not duplicated', () => {
  const acc = createAnswerAccumulator();
  acc.push(0, results(['hello', false]));
  acc.push(0, results(['hello world', true]));
  assert.equal(acc.answer(), 'hello world');
});

test('two phrases are joined in order, each once', () => {
  const acc = createAnswerAccumulator();
  acc.push(0, results(['I like', false]));
  acc.push(0, results(['I like Python', true]));
  acc.push(1, results(['I like Python', true], ['and', false]));
  acc.push(1, results(['I like Python', true], ['and Go', true]));
  assert.equal(acc.answer(), 'I like Python and Go');
});

test('words not finalized yet are included in the answer', () => {
  const acc = createAnswerAccumulator();
  acc.push(0, results(['first part', true]));
  acc.push(1, results(['first part', true], ['still talking', false]));
  assert.equal(acc.finalText, 'first part');
  assert.equal(acc.interim, 'still talking');
  assert.equal(acc.answer(), 'first part still talking');
});

test('keeps the answer across a recognizer restart (results start again at 0)', () => {
  const acc = createAnswerAccumulator();
  acc.push(0, results(['before the restart', true]));
  acc.push(0, results(['after it', true]));
  assert.equal(acc.answer(), 'before the restart after it');
});

test('reset starts a new answer', () => {
  const acc = createAnswerAccumulator();
  acc.push(0, results(['old answer', true]));
  acc.reset();
  assert.equal(acc.answer(), '');
});
