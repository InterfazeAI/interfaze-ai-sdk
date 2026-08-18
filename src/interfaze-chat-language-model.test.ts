import type {
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createInterfaze } from './interfaze-provider';

const TEST_PROMPT: LanguageModelV4Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
];

async function convertStreamToArray(
  stream: ReadableStream<LanguageModelV4StreamPart>,
) {
  const reader = stream.getReader();
  const chunks: LanguageModelV4StreamPart[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  return chunks;
}

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

describe('doGenerate', () => {
  it('extracts vcache into providerMetadata.interfaze', async () => {
    const fetch = createJsonFixtureFetchMock('interfaze-basic');
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    const result = await model.doGenerate({ prompt: TEST_PROMPT });

    expect(result.content).toEqual([
      { type: 'text', text: 'The magic number is 2026.' },
    ]);
    expect(result.providerMetadata?.interfaze).toEqual({ vcache: true });
  });

  it('extracts reasoning and precontext into providerMetadata.interfaze', async () => {
    const fetch = createJsonFixtureFetchMock('interfaze-precontext');
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    const result = await model.doGenerate({ prompt: TEST_PROMPT });

    expect(result.providerMetadata?.interfaze).toEqual({
      vcache: false,
      reasoning:
        'The user asked about SF weather; the web_search task returned current conditions.',
      precontext: [
        { name: 'web_search', result: { temperature: 62, condition: 'sunny' } },
      ],
    });
  });

  it('defensively strips inline <think> tags that leak into content', async () => {
    const fetch = createJsonFixtureFetchMock('interfaze-inline-tags');
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    const result = await model.doGenerate({ prompt: TEST_PROMPT });

    expect(result.content).toEqual([
      { type: 'text', text: 'The answer is 42.' },
    ]);
    expect(result.providerMetadata?.interfaze).toEqual({
      vcache: false,
      reasoning: 'Let me compute this.',
    });
  });

  it('unwraps the ```json fence in schema-less JSON mode', async () => {
    const fetch = createJsonFixtureFetchMock('interfaze-json-fence');
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    const result = await model.doGenerate({
      prompt: TEST_PROMPT,
      responseFormat: { type: 'json' },
    });

    expect(result.content).toEqual([
      { type: 'text', text: '{"result":"2026"}' },
    ]);
  });

  it('does not unwrap the fence when a schema is present (json_schema mode)', async () => {
    const fetch = createJsonFixtureFetchMock('interfaze-json-fence');
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    const result = await model.doGenerate({
      prompt: TEST_PROMPT,
      responseFormat: {
        type: 'json',
        schema: { type: 'object', properties: { result: { type: 'string' } } },
      },
    });

    expect(result.content).toEqual([
      { type: 'text', text: '```json\n{"result":"2026"}\n```' },
    ]);
  });

  it('sends a video file part in the shape Interfaze expects', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    await model.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Summarize this clip.' },
            {
              type: 'file',
              mediaType: 'video/mp4',
              filename: 'clip.mp4',
              data: { type: 'data', data: 'AQID' },
            },
          ],
        },
      ],
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Summarize this clip.' },
      {
        type: 'file',
        file: {
          file_data: 'data:video/mp4;base64,AQID',
          filename: 'clip.mp4',
          format: 'video/mp4',
        },
      },
    ]);
  });

  it('sends providerOptions.interfaze.precontext as a top-level request field', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    await model.doGenerate({
      prompt: TEST_PROMPT,
      providerOptions: {
        interfaze: { precontext: [{ name: 'ocr', result: 'x' }] },
      },
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.precontext).toEqual([{ name: 'ocr', result: 'x' }]);
  });

  it('serializes providerOptions.interfaze.guard into a <guard> system message and maps reasoningEffort', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    await model.doGenerate({
      prompt: TEST_PROMPT,
      providerOptions: {
        interfaze: { guard: ['S1', 'S12_IMAGE'], reasoningEffort: 'high' },
      },
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.guard).toBeUndefined();
    expect(body.reasoningEffort).toBeUndefined();
    expect(body.reasoning_effort).toBe('high');
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: '<guard>S1, S12_IMAGE</guard>',
    });
  });
});

describe('doStream', () => {
  it('strips a <think> block split across chunk boundaries and surfaces reasoning in finish metadata', async () => {
    const fetch = createStreamFixtureFetchMock('interfaze-think-stream');
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    const { stream } = await model.doStream({ prompt: TEST_PROMPT });
    const chunks = await convertStreamToArray(stream);

    const textDeltas = chunks
      .filter(chunk => chunk.type === 'text-delta')
      .map(chunk => (chunk as { delta: string }).delta);
    expect(textDeltas.join('')).toBe('It is sunny.');

    const finish = chunks.at(-1);
    expect(finish?.type).toBe('finish');
    expect((finish as any).providerMetadata?.interfaze).toEqual(
      expect.objectContaining({
        reasoning: 'Thinking about the weather.',
      }),
    );
  });

  it('emits an unterminated tag verbatim on a completed stream (it is prose, not a channel)', async () => {
    const fetch = createStreamFixtureFetchMock('interfaze-think-only-stream');
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    const { stream } = await model.doStream({ prompt: TEST_PROMPT });
    const chunks = await convertStreamToArray(stream);

    // A completed response's unclosed tag is prose and must survive verbatim.
    const textDeltas = chunks
      .filter(chunk => chunk.type === 'text-delta')
      .map(chunk => (chunk as { delta: string }).delta);
    expect(textDeltas.join('')).toBe(
      'Wrap your reasoning in <think> tags so it stays hidden.',
    );

    const finish = chunks.at(-1);
    expect(finish?.type).toBe('finish');
    // It is prose, so it must not be misreported as reasoning.
    expect(
      (finish as any).providerMetadata?.interfaze?.reasoning,
    ).toBeUndefined();
  });

  it('drops an unterminated tag on a truncated stream instead of leaking it', async () => {
    const fetch = createStreamFixtureFetchMock(
      'interfaze-truncated-think-stream',
    );
    const model = createInterfaze({ apiKey: 'test-api-key', fetch })(
      'interfaze-beta',
    );

    const { stream } = await model.doStream({ prompt: TEST_PROMPT });
    const chunks = await convertStreamToArray(stream);

    // A truncated `<think>` is dropped, not surfaced as the answer.
    const textDeltas = chunks
      .filter(chunk => chunk.type === 'text-delta')
      .map(chunk => (chunk as { delta: string }).delta);
    expect(textDeltas.join('')).toBe('');

    const finish = chunks.at(-1);
    expect(finish?.type).toBe('finish');
    expect(
      (finish as any).providerMetadata?.interfaze?.reasoning,
    ).toBeUndefined();
  });
});
