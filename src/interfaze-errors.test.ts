import { APICallError } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { createInterfaze } from './interfaze-provider';

/**
 * Interfaze nests errors under `error` on both paths:
 *  - JSON body: `buildErrorResponse` -> `formatErrorResponse`
 *  - SSE chunk: `handleErrorStreamingResponse` (`event: error`)
 *
 * A flat error schema still *parses nothing*, which silently degrades the
 * message to `response.statusText`, so these assert the real wire shape.
 */
const errorBody = {
  error: {
    message: "Invalid request parameters: Field 'temperature': too big",
    type: 'validation_error',
    code: 'invalid_request',
    request_id: 'req-abc',
  },
};

function providerReturning(response: () => Response) {
  return createInterfaze({ apiKey: 'test-key', fetch: async () => response() });
}

describe('interfaze error handling', () => {
  it('surfaces the API error message on a non-streaming call', async () => {
    const model = providerReturning(
      () =>
        new Response(JSON.stringify(errorBody), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        }),
    )('interfaze-beta');

    let error: unknown;
    try {
      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      });
    } catch (e) {
      error = e;
    }

    expect(APICallError.isInstance(error)).toBe(true);
    const apiError = error as APICallError;
    expect(apiError.statusCode).toBe(400);
    expect(apiError.message).toBe(errorBody.error.message);
    expect(apiError.data).toEqual(errorBody);
  });

  it('surfaces a mid-stream error chunk instead of a type-validation failure', async () => {
    const sse =
      `data: ${JSON.stringify({
        id: 'c',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'interfaze-beta',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'partial' },
            finish_reason: null,
          },
        ],
      })}\n\n` +
      `event: error\ndata: ${JSON.stringify(errorBody)}\n\n` +
      `data: [DONE]\n\n`;

    const model = providerReturning(
      () =>
        new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )('interfaze-beta');

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });

    // read via a reader rather than `for await` — the stream is a DOM
    // ReadableStream, which isn't async-iterable under this tsconfig's libs.
    const errors: unknown[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === 'error') errors.push(value.error);
    }

    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0])).toContain(errorBody.error.message);
    expect(JSON.stringify(errors[0])).not.toContain('TypeValidation');
  });
});
