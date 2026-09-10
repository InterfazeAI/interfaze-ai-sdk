import type { FetchFunction } from '@ai-sdk/provider-utils';
import { generateText, Output, streamText } from 'ai';
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createInterfaze } from './interfaze-provider';

/**
 * The other suites assert against the `LanguageModelV4` boundary. These drive
 * the model through the `ai` package instead, so the surface the README tells
 * users to read — `finalStep.providerMetadata` — stays wired to the metadata
 * `doGenerate` / `doStream` attach.
 */

function createJsonFixtureFetchMock(filename: string) {
  return vi.fn().mockResolvedValue(
    new Response(fs.readFileSync(`src/__fixtures__/${filename}.json`, 'utf8'), {
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function createStreamFixtureFetchMock(filename: string) {
  const chunks = fs
    .readFileSync(`src/__fixtures__/${filename}.chunks.txt`, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0);

  return vi
    .fn()
    .mockResolvedValue(
      new Response(
        [...chunks.map(chunk => `data: ${chunk}\n\n`), 'data: [DONE]\n\n'].join(
          '',
        ),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    );
}

const modelWith = (fetch: FetchFunction) =>
  createInterfaze({ apiKey: 'test-api-key', fetch })('interfaze-beta');

describe('generateText', () => {
  it('exposes interfaze metadata on finalStep.providerMetadata', async () => {
    const result = await generateText({
      model: modelWith(createJsonFixtureFetchMock('interfaze-precontext')),
      prompt: 'What is the weather in San Francisco?',
    });

    expect(result.text).toBe('San Francisco is currently 62°F and sunny.');
    expect(result.finalStep.providerMetadata?.interfaze).toEqual({
      vcache: false,
      reasoning:
        'The user asked about SF weather; the web_search task returned current conditions.',
      precontext: [
        { name: 'web_search', result: { temperature: 62, condition: 'sunny' } },
      ],
    });
  });
});

describe('streamText', () => {
  it('strips side channels from textStream and exposes reasoning on finalStep', async () => {
    // Destructured, as the README and `examples/streaming.ts` show it:
    // `finalStep` is the promise itself, so it still resolves once the
    // stream has drained.
    const { textStream, finalStep } = streamText({
      model: modelWith(createStreamFixtureFetchMock('interfaze-think-stream')),
      prompt: 'What is the weather?',
    });

    let text = '';
    for await (const delta of textStream) {
      text += delta;
    }

    expect(text).toBe('It is sunny.');
    expect((await finalStep).providerMetadata?.interfaze).toEqual({
      vcache: false,
      reasoning: 'Thinking about the weather.',
    });
  });
});

describe('generateText + Output.object', () => {
  it('returns the typed output alongside interfaze metadata', async () => {
    const { output, finalStep } = await generateText({
      model: modelWith(createJsonFixtureFetchMock('interfaze-structured')),
      output: Output.object({
        schema: z.object({ city: z.string(), country: z.string() }),
      }),
      prompt: 'Capital of France as {city, country}.',
    });

    expect(output).toEqual({ city: 'Paris', country: 'France' });
    expect(finalStep.providerMetadata?.interfaze).toEqual({
      vcache: false,
      precontext: [{ name: 'ocr', result: { text: 'Paris, France' } }],
    });
  });
});
