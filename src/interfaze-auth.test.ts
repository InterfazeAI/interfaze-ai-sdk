import { LoadAPIKeyError } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { generateText, streamText, type LanguageModel } from 'ai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import {
  createJsonFixtureFetchMock,
  createStreamFixtureFetchMock,
} from './__fixtures__/fetch-mocks';
import {
  createInterfaze,
  interfaze,
  type InterfazeErrorData,
} from './interfaze-provider';

/**
 * Asserts on the `Authorization` header that reaches the transport. Every
 * test starts with `INTERFAZE_API_KEY` and `OPENAI_API_KEY` unset, so a key in
 * the developer's shell cannot leak into a result.
 */

const PROMPT = 'hi';
const ENV_KEY = 'test-env-key';
const EXPLICIT_KEY = 'test-explicit-key';
const OPENAI_KEY = 'test-openai-key';
const NO_RETRIES = 0;

const invalidKeyBody = {
  error: {
    message: 'The API key provided is not valid',
    type: 'permission_error',
    code: 'insufficient_quota',
    request_id: 'req-invalid-key',
  },
} satisfies InterfazeErrorData;

const keylessLimitBody = {
  error: {
    message:
      'Keyless daily limit of 50 requests reached. Get a free API key at https://interfaze.ai and send it as `Authorization: Bearer YOUR_API_KEY`.',
    type: 'rate_limit_error',
    code: 'keyless_daily_limit_exceeded',
    request_id: 'req-keyless-limit',
  },
} satisfies InterfazeErrorData;

const errorFetch = (status: number, body: InterfazeErrorData) =>
  vi.fn<FetchFunction>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );

/** The `Authorization` header of each request, in order; `null` when absent. */
const sentAuthorizations = (fetch: Mock<FetchFunction>) =>
  fetch.mock.calls.map(([, init]) =>
    new Headers(init?.headers).get('authorization'),
  );

/** Resolves with the streamed text, or rejects with the stream's error part. */
const runStreamText = (model: LanguageModel, maxRetries?: number) =>
  new Promise<string>((resolve, reject) => {
    streamText({
      model,
      prompt: PROMPT,
      maxRetries,
      onError: ({ error }) => reject(error),
    }).text.then(resolve, reject);
  });

const modes = [
  {
    name: 'generateText',
    succeed: () =>
      vi.fn<FetchFunction>(createJsonFixtureFetchMock('interfaze-basic')),
    run: (model: LanguageModel, maxRetries?: number) =>
      generateText({ model, prompt: PROMPT, maxRetries }).then(r => r.text),
  },
  {
    name: 'streamText',
    succeed: () =>
      vi.fn<FetchFunction>(
        createStreamFixtureFetchMock('interfaze-think-stream'),
      ),
    run: runStreamText,
  },
];

beforeEach(() => {
  vi.stubEnv('INTERFAZE_API_KEY', undefined);
  vi.stubEnv('OPENAI_API_KEY', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(modes)('$name authentication', ({ succeed, run }) => {
  describe('createInterfaze', () => {
    it('sends no Authorization header without a key', async () => {
      const fetch = succeed();
      await run(createInterfaze({ fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([null]);
    });

    it('sends no Authorization header when only OPENAI_API_KEY is set', async () => {
      vi.stubEnv('OPENAI_API_KEY', OPENAI_KEY);
      const fetch = succeed();
      await run(createInterfaze({ fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([null]);
    });

    it('sends INTERFAZE_API_KEY as a bearer token', async () => {
      vi.stubEnv('INTERFAZE_API_KEY', ENV_KEY);
      const fetch = succeed();
      await run(createInterfaze({ fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([`Bearer ${ENV_KEY}`]);
    });

    it('prefers an explicit apiKey over INTERFAZE_API_KEY', async () => {
      vi.stubEnv('INTERFAZE_API_KEY', ENV_KEY);
      const fetch = succeed();
      await run(createInterfaze({ apiKey: EXPLICIT_KEY, fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([`Bearer ${EXPLICIT_KEY}`]);
    });

    it('surfaces a 401 for a bad key without a keyless retry', async () => {
      const fetch = errorFetch(401, invalidKeyBody);
      const model = createInterfaze({ apiKey: EXPLICIT_KEY, fetch })(
        'interfaze',
      );

      await expect(run(model)).rejects.toMatchObject({
        statusCode: 401,
        message: invalidKeyBody.error.message,
        data: invalidKeyBody,
      });
      expect(sentAuthorizations(fetch)).toEqual([`Bearer ${EXPLICIT_KEY}`]);
    });

    it('surfaces a keyless 429 with its code and key guidance', async () => {
      const fetch = errorFetch(429, keylessLimitBody);
      const model = createInterfaze({ fetch })('interfaze');

      await expect(run(model, NO_RETRIES)).rejects.toMatchObject({
        statusCode: 429,
        isRetryable: true,
        message: keylessLimitBody.error.message,
        data: keylessLimitBody,
      });
      expect(sentAuthorizations(fetch)).toEqual([null]);
    });
  });

  describe('default interfaze provider', () => {
    it('sends no Authorization header without INTERFAZE_API_KEY', async () => {
      vi.stubEnv('OPENAI_API_KEY', OPENAI_KEY);
      const fetch = succeed();
      vi.stubGlobal('fetch', fetch);
      await run(interfaze('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([null]);
    });

    it('reads INTERFAZE_API_KEY when the request is sent', async () => {
      const fetch = succeed();
      vi.stubGlobal('fetch', fetch);
      vi.stubEnv('INTERFAZE_API_KEY', ENV_KEY);
      await run(interfaze('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([`Bearer ${ENV_KEY}`]);
    });
  });
});

describe('blank keys', () => {
  const [{ succeed, run }] = modes;

  it('treats a blank INTERFAZE_API_KEY as unset', async () => {
    vi.stubEnv('INTERFAZE_API_KEY', '  ');
    const fetch = succeed();
    await run(createInterfaze({ fetch })('interfaze'));

    expect(sentAuthorizations(fetch)).toEqual([null]);
  });

  it('uses INTERFAZE_API_KEY when apiKey is empty', async () => {
    vi.stubEnv('INTERFAZE_API_KEY', ENV_KEY);
    const fetch = succeed();
    await run(createInterfaze({ apiKey: '', fetch })('interfaze'));

    expect(sentAuthorizations(fetch)).toEqual([`Bearer ${ENV_KEY}`]);
  });
});

describe('runtimes without process.env', () => {
  it('requires an explicit apiKey and sends no request', async () => {
    const fetch = vi.fn<FetchFunction>();
    const model = createInterfaze({ fetch })('interfaze');
    vi.stubGlobal('process', undefined);

    const result = model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: PROMPT }] }],
    });

    await expect(result).rejects.toSatisfy(LoadAPIKeyError.isInstance);
    vi.unstubAllGlobals();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('browsers with a process polyfill', () => {
  const [{ succeed, run }] = modes;

  beforeEach(() => {
    vi.stubGlobal('document', {});
  });

  it('requires a key and sends no request', async () => {
    const fetch = succeed();

    await expect(
      run(createInterfaze({ fetch })('interfaze')),
    ).rejects.toSatisfy(LoadAPIKeyError.isInstance);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends an explicit apiKey', async () => {
    const fetch = succeed();
    await run(createInterfaze({ apiKey: EXPLICIT_KEY, fetch })('interfaze'));

    expect(sentAuthorizations(fetch)).toEqual([`Bearer ${EXPLICIT_KEY}`]);
  });
});
