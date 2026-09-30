// Builds one spoken answer from Web Speech API `onresult` events. Kept pure (no React, no
// browser APIs) so it can be unit-tested: the hook used to append the last final phrase twice,
// because it combined a ref that already held that phrase with the phrase itself.

export interface SpeechResultList {
  length: number;
  [index: number]: {
    isFinal: boolean;
    [index: number]: { transcript: string };
  };
}

function join(a: string, b: string): string {
  return a && b ? `${a} ${b}` : a || b;
}

export function createAnswerAccumulator() {
  let finalText = '';
  let interim = '';

  return {
    reset() {
      finalText = '';
      interim = '';
    },
    // `results` holds every result of the current recognition session; `resultIndex` is the first
    // one that changed. A final result never changes again, so each one is added exactly once.
    push(resultIndex: number, results: SpeechResultList) {
      let newFinal = '';
      interim = '';
      for (let i = resultIndex; i < results.length; i++) {
        const text = results[i][0]?.transcript ?? '';
        if (results[i].isFinal) newFinal += text;
        else interim += text;
      }
      finalText = join(finalText, newFinal.trim());
      interim = interim.trim();
    },
    get finalText() {
      return finalText;
    },
    get interim() {
      return interim;
    },
    // The answer so far, including words the recognizer hasn't finalized yet — once we hand the
    // answer off we stop listening, so a late final result for them would never arrive.
    answer() {
      return join(finalText, interim);
    },
  };
}
