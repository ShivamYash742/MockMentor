import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';

if (!process.env.GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY is missing');
}

export const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
  // Optional: an OpenAI-compatible stand-in (a proxy, or a local mock for end-to-end tests).
  ...(process.env.GROQ_BASE_URL ? { baseURL: process.env.GROQ_BASE_URL } : {}),
});

// Bigger model first: better quality, with the smaller one as a fallback if it's unavailable.
const FALLBACK_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
] as const;

export interface GenerateOptions {
  temperature?: number;
  timeoutMs?: number;
  // Override the default model order — e.g. a caller that only wants the faster model.
  models?: readonly string[];
  // For structured output: pass Output.object({ schema }) from 'ai'. Populates result.output.
  output?: Parameters<typeof generateText>[0]['output'];
}

export async function generateWithGroq(
  prompt: string,
  opts?: GenerateOptions
) {
  let lastError: unknown = null;
  const models = opts?.models ?? FALLBACK_MODELS;

  for (const modelName of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 8000);

    try {
      console.log(`[groq] Trying ${modelName}...`);

      const result = await generateText({
        model: groq(modelName),
        prompt,
        temperature: opts?.temperature ?? 0.7,
        maxRetries: 0,
        abortSignal: controller.signal,
        ...(opts?.output ? { output: opts.output } : {}),
      });

      console.log(`[groq] Success: ${modelName}`);
      return result;

    } catch (e: unknown) {
      const error = e as { statusCode?: number; message?: string; name?: string };
      console.warn(`[groq] Failed: ${modelName}`, {
        status: error.statusCode,
        message: error.message,
      });

      lastError = e;

      if (error.statusCode === 404) continue;
      if (error.statusCode === 429 || error.statusCode === 503) continue;
      if (error.name === 'AbortError') continue;

      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('All Groq models failed');
}
