import { generateText, Output, streamText } from 'ai';
import { describe, expect, it } from 'vitest';
import { z as zod3 } from 'zod';
import { z } from 'zod/v4';
import {
  createCapturingFetchMock,
  createJsonFixtureFetchMock,
  createStreamFixtureFetchMock,
  modelWith,
} from './__fixtures__/fetch-mocks';

/**
 * The other suites assert against the `LanguageModelV4` boundary. These drive
 * the model through the `ai` package instead, so the surface the README tells
 * users to read — `finalStep.providerMetadata`, `Output.object`, `stream` —
 * stays wired to what `doGenerate` / `doStream` produce.
 */

const cityAndCountry = z.object({ city: z.string(), country: z.string() });

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

  it('emits side-channel-free text on the `stream` part stream', async () => {
    const { stream } = streamText({
      model: modelWith(createStreamFixtureFetchMock('interfaze-think-stream')),
      prompt: 'What is the weather?',
    });

    const partTypes: string[] = [];
    let text = '';
    for await (const part of stream) {
      partTypes.push(part.type);
      if (part.type === 'text-delta') {
        text += part.text;
      }
    }

    expect(text).toBe('It is sunny.');
    expect(partTypes).toContain('finish');
    expect(text).not.toContain('<think>');
  });

  it('resolves a typed output from a stream via Output.object', async () => {
    const { partialOutputStream, output } = streamText({
      model: modelWith(createStreamFixtureFetchMock('interfaze-structured')),
      output: Output.object({ schema: cityAndCountry }),
      prompt: 'Capital of France as {city, country}.',
    });

    let partials = 0;
    for await (const _partial of partialOutputStream) {
      partials++;
    }

    expect(partials).toBeGreaterThan(0);
    expect(await output).toEqual({ city: 'Paris', country: 'France' });
  });
});

describe('generateText + Output.object', () => {
  it('returns the typed output alongside interfaze metadata', async () => {
    const { output, finalStep } = await generateText({
      model: modelWith(createJsonFixtureFetchMock('interfaze-structured')),
      output: Output.object({ schema: cityAndCountry }),
      prompt: 'Capital of France as {city, country}.',
    });

    expect(output).toEqual({ city: 'Paris', country: 'France' });
    expect(finalStep.providerMetadata?.interfaze).toEqual({
      vcache: false,
      precontext: [{ name: 'ocr', result: { text: 'Paris, France' } }],
    });
  });

  it('sends the schema as a json_schema response_format', async () => {
    const { fetch, requests } = createCapturingFetchMock(
      'interfaze-structured',
    );

    await generateText({
      model: modelWith(fetch),
      output: Output.object({ schema: cityAndCountry }),
      prompt: 'Capital of France as {city, country}.',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'response',
        strict: true,
        schema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: { city: { type: 'string' }, country: { type: 'string' } },
          required: ['city', 'country'],
          additionalProperties: false,
        },
      },
    });
  });

  // `src` builds its own option schemas with `zod/v4`, but the package accepts
  // either flavour (`zod: ^3.25.76 || ^4.1.8`), so both must reach the wire as
  // the same JSON Schema.
  it('produces an equivalent schema from zod 3 and zod 4', async () => {
    const zod4 = createCapturingFetchMock('interfaze-structured');
    await generateText({
      model: modelWith(zod4.fetch),
      output: Output.object({ schema: cityAndCountry }),
      prompt: 'p',
    });

    const legacy = createCapturingFetchMock('interfaze-structured');
    await generateText({
      model: modelWith(legacy.fetch),
      output: Output.object({
        schema: zod3.object({ city: zod3.string(), country: zod3.string() }),
      }),
      prompt: 'p',
    });

    expect(legacy.requests[0].response_format).toEqual(
      zod4.requests[0].response_format,
    );
  });
});
