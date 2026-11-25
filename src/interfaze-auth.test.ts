import { LoadAPIKeyError } from '@ai-sdk/provider';
import { APICallError, generateText, streamText, type LanguageModel } from 'ai';
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

const PROMPT = 'hi';
const ENV_KEY = 'sk-test-env';
const EXPLICIT_KEY = 'sk-test-explicit';
const OPENAI_KEY = 'sk-openai-synthetic';
const CUSTOM_AUTHORIZATION = 'Custom abc';
const NO_RETRIES = 0;
const SINGLE_ATTEMPT = 1;
const DEFAULT_ATTEMPTS = 3;
const DAILY_RETRY_AFTER_SECONDS = 3600;
const DAILY_RESET_EPOCH_SECONDS = 1_900_000_000;

const BLANK_KEYS = ['', ' \n'];
const AUTHORIZATION_SPELLINGS = ['Authorization', 'authorization'];

const SIGNUP_HINT =
  'Get a free API key at https://interfaze.ai and send it as `Authorization: Bearer YOUR_API_KEY`.';

const invalidKeyBody = {
  error: {
    message: 'The API key provided is not valid',
    type: 'permission_error',
    code: 'insufficient_quota',
    request_id: 'req-invalid-key',
  },
} satisfies InterfazeErrorData;

const dailyLimitBody = {
  error: {
    message: `Keyless daily limit of 1000 requests reached. ${SIGNUP_HINT}`,
    type: 'rate_limit_error',
    code: 'keyless_daily_limit_exceeded',
    request_id: 'req-daily-limit',
  },
} satisfies InterfazeErrorData;

const dailyLimitHeaders = {
  'retry-after': String(DAILY_RETRY_AFTER_SECONDS),
  'x-ratelimit-limit': '1000',
  'x-ratelimit-remaining': '0',
  'x-ratelimit-reset': String(DAILY_RESET_EPOCH_SECONDS),
};

const inflightLimitBody = {
  error: {
    message: `Too many keyless requests in progress (limit 5). ${SIGNUP_HINT}`,
    type: 'rate_limit_error',
    code: 'keyless_inflight_limit_exceeded',
    request_id: 'req-inflight-limit',
  },
} satisfies InterfazeErrorData;

const inflightLimitHeaders = { 'retry-after': '5' };

const errorFetch = (
  status: number,
  body: InterfazeErrorData,
  headers: Record<string, string> = {},
) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
  );

/** The `Authorization` header of each request, in order; `null` when absent. */
const sentAuthorizations = (transport: Mock<typeof fetch>) =>
  transport.mock.calls.map(([, init]) =>
    new Headers(init?.headers).get('authorization'),
  );

type RunOptions = {
  maxRetries?: number;
  headers?: Record<string, string>;
};

/** Resolves with the streamed text, or rejects with the stream's error part. */
const runStreamText = (model: LanguageModel, options: RunOptions = {}) =>
  new Promise<string>((resolve, reject) => {
    streamText({
      model,
      prompt: PROMPT,
      ...options,
      onError: ({ error }) => reject(error),
    }).text.then(resolve, reject);
  });

const modes = [
  {
    name: 'generateText',
    succeed: () =>
      vi.fn<typeof fetch>(createJsonFixtureFetchMock('interfaze-basic')),
    run: (model: LanguageModel, options: RunOptions = {}) =>
      generateText({ model, prompt: PROMPT, ...options }).then(r => r.text),
  },
  {
    name: 'streamText',
    succeed: () =>
      vi.fn<typeof fetch>(
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
  vi.useRealTimers();
  // Restore `process` before the env, because the env restore reads it.
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

    it('surfaces a 401 for a bad key after one request', async () => {
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

    it('surfaces a keyless 401 after one request', async () => {
      const fetch = errorFetch(401, invalidKeyBody);
      const model = createInterfaze({ fetch })('interfaze');

      await expect(run(model)).rejects.toMatchObject({
        statusCode: 401,
        message: invalidKeyBody.error.message,
        data: invalidKeyBody,
      });
      expect(sentAuthorizations(fetch)).toEqual([null]);
    });

    it('throws the keyless daily limit after one request, without a wait', async () => {
      const fetch = errorFetch(429, dailyLimitBody, dailyLimitHeaders);
      const model = createInterfaze({ fetch })('interfaze');

      const result = run(model);

      await expect(result).rejects.toSatisfy(APICallError.isInstance);
      await expect(result).rejects.toMatchObject({
        statusCode: 429,
        isRetryable: false,
        message: dailyLimitBody.error.message,
        data: dailyLimitBody,
        responseHeaders: dailyLimitHeaders,
      });
      expect(fetch).toHaveBeenCalledTimes(SINGLE_ATTEMPT);
      expect(sentAuthorizations(fetch)).toEqual([null]);
    });

    it('retries a keyless in-flight 429 and then throws a RetryError', async () => {
      vi.useFakeTimers();
      const fetch = errorFetch(429, inflightLimitBody, inflightLimitHeaders);
      const model = createInterfaze({ fetch })('interfaze');

      const result = expect(run(model)).rejects.toMatchObject({
        reason: 'maxRetriesExceeded',
        lastError: {
          statusCode: 429,
          isRetryable: true,
          message: inflightLimitBody.error.message,
          data: inflightLimitBody,
        },
      });
      await vi.runAllTimersAsync();

      await result;
      expect(fetch).toHaveBeenCalledTimes(DEFAULT_ATTEMPTS);
    });
  });

  describe('caller Authorization header', () => {
    it.each(AUTHORIZATION_SPELLINGS)(
      'sends a default %s header without a key',
      async spelling => {
        const fetch = succeed();
        const model = createInterfaze({
          fetch,
          headers: { [spelling]: CUSTOM_AUTHORIZATION },
        })('interfaze');
        await run(model);

        expect(sentAuthorizations(fetch)).toEqual([CUSTOM_AUTHORIZATION]);
      },
    );

    it.each(AUTHORIZATION_SPELLINGS)(
      'sends a default %s header instead of the key, once',
      async spelling => {
        const fetch = succeed();
        const model = createInterfaze({
          apiKey: EXPLICIT_KEY,
          fetch,
          headers: { [spelling]: CUSTOM_AUTHORIZATION },
        })('interfaze');
        await run(model);

        expect(sentAuthorizations(fetch)).toEqual([CUSTOM_AUTHORIZATION]);
      },
    );

    it.each(AUTHORIZATION_SPELLINGS)(
      'sends a per-request %s header without a key',
      async spelling => {
        const fetch = succeed();
        await run(createInterfaze({ fetch })('interfaze'), {
          headers: { [spelling]: CUSTOM_AUTHORIZATION },
        });

        expect(sentAuthorizations(fetch)).toEqual([CUSTOM_AUTHORIZATION]);
      },
    );

    it.each(AUTHORIZATION_SPELLINGS)(
      'sends a per-request %s header instead of the key, once',
      async spelling => {
        const fetch = succeed();
        await run(
          createInterfaze({ apiKey: EXPLICIT_KEY, fetch })('interfaze'),
          { headers: { [spelling]: CUSTOM_AUTHORIZATION } },
        );

        expect(sentAuthorizations(fetch)).toEqual([CUSTOM_AUTHORIZATION]);
      },
    );
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

  describe.each(BLANK_KEYS)('blank key %j', blank => {
    it('sends no Authorization header when apiKey is blank and the env is unset', async () => {
      const fetch = succeed();
      await run(createInterfaze({ apiKey: blank, fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([null]);
    });

    it('sends INTERFAZE_API_KEY when apiKey is blank', async () => {
      vi.stubEnv('INTERFAZE_API_KEY', ENV_KEY);
      const fetch = succeed();
      await run(createInterfaze({ apiKey: blank, fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([`Bearer ${ENV_KEY}`]);
    });

    it('sends no Authorization header when INTERFAZE_API_KEY is blank', async () => {
      vi.stubEnv('INTERFAZE_API_KEY', blank);
      const fetch = succeed();
      await run(createInterfaze({ fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([null]);
    });

    it('sends the explicit apiKey when INTERFAZE_API_KEY is blank', async () => {
      vi.stubEnv('INTERFAZE_API_KEY', blank);
      const fetch = succeed();
      await run(createInterfaze({ apiKey: EXPLICIT_KEY, fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([`Bearer ${EXPLICIT_KEY}`]);
    });
  });

  describe('runtimes without process', () => {
    beforeEach(() => {
      vi.stubGlobal('process', undefined);
    });

    it('goes keyless when there is no process and no document', async () => {
      const fetch = succeed();
      await run(createInterfaze({ fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([null]);
    });

    it('sends an explicit apiKey', async () => {
      const fetch = succeed();
      await run(createInterfaze({ apiKey: EXPLICIT_KEY, fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([`Bearer ${EXPLICIT_KEY}`]);
    });
  });

  describe('browsers with a process polyfill', () => {
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

    it.each(BLANK_KEYS)('requires a key when apiKey is %j', async blank => {
      const fetch = succeed();

      await expect(
        run(createInterfaze({ apiKey: blank, fetch })('interfaze')),
      ).rejects.toSatisfy(LoadAPIKeyError.isInstance);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('sends an explicit apiKey', async () => {
      const fetch = succeed();
      await run(createInterfaze({ apiKey: EXPLICIT_KEY, fetch })('interfaze'));

      expect(sentAuthorizations(fetch)).toEqual([`Bearer ${EXPLICIT_KEY}`]);
    });

    it.each(AUTHORIZATION_SPELLINGS)(
      'sends a default %s header without a key',
      async spelling => {
        const fetch = succeed();
        const model = createInterfaze({
          fetch,
          headers: { [spelling]: CUSTOM_AUTHORIZATION },
        })('interfaze');
        await run(model);

        expect(sentAuthorizations(fetch)).toEqual([CUSTOM_AUTHORIZATION]);
      },
    );
  });
});

// streamText leaves an unhandled rejection for any stream error when `process` is missing,
// so this case runs through generateText. The streamText guard runs in the polyfill tests above.
describe('a browser without process', () => {
  it('requires a key and sends no request', async () => {
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('document', {});
    const transport = vi.fn<typeof fetch>(
      createJsonFixtureFetchMock('interfaze-basic'),
    );

    await expect(
      generateText({
        model: createInterfaze({ fetch: transport })('interfaze'),
        prompt: PROMPT,
      }),
    ).rejects.toSatisfy(LoadAPIKeyError.isInstance);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('retry classification', () => {
  const { run } = modes[0];
  const retryableStatuses = [408, 409, 429, 500, 503];
  const permanentStatuses = [400, 401, 403, 404, 422];
  const otherCodeBody = {
    error: { ...dailyLimitBody.error, code: 'rate_limit_exceeded' },
  } satisfies InterfazeErrorData;

  const rejection = (transport: Mock<typeof fetch>) =>
    run(createInterfaze({ fetch: transport })('interfaze'), {
      maxRetries: NO_RETRIES,
    });

  it.each(retryableStatuses)('keeps %i retryable', async status => {
    const fetch = errorFetch(status, invalidKeyBody);

    await expect(rejection(fetch)).rejects.toMatchObject({
      statusCode: status,
      isRetryable: true,
    });
  });

  it.each(permanentStatuses)('keeps %i not retryable', async status => {
    const fetch = errorFetch(status, invalidKeyBody);

    await expect(rejection(fetch)).rejects.toMatchObject({
      statusCode: status,
      isRetryable: false,
    });
  });

  it.each(retryableStatuses.filter(status => status !== 429))(
    'keeps %i retryable when the body has the daily-limit code',
    async status => {
      const fetch = errorFetch(status, dailyLimitBody);

      await expect(rejection(fetch)).rejects.toMatchObject({
        statusCode: status,
        isRetryable: true,
      });
    },
  );

  it('keeps a 429 with another code retryable', async () => {
    const fetch = errorFetch(429, otherCodeBody);

    await expect(rejection(fetch)).rejects.toMatchObject({
      statusCode: 429,
      isRetryable: true,
    });
  });

  it('keeps a 429 with an unparseable body retryable', async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response('slow down', { status: 429 }),
    );

    await expect(rejection(transport)).rejects.toMatchObject({
      statusCode: 429,
      isRetryable: true,
    });
  });

  it('keeps a 429 with an empty body retryable', async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response('', { status: 429 }),
    );

    await expect(rejection(transport)).rejects.toMatchObject({
      statusCode: 429,
      isRetryable: true,
    });
  });
});
