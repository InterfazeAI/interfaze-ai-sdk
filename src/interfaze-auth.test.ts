import { LoadAPIKeyError } from '@ai-sdk/provider';
import { APICallError, generateText, type LanguageModel } from 'ai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { createJsonFixtureFetchMock } from './__fixtures__/fetch-mocks';
import {
  createInterfaze,
  interfaze,
  type InterfazeErrorData,
} from './interfaze-provider';

const PROMPT = 'hi';
const ENV_KEY = 'sk-test-env';
const EXPLICIT_KEY = 'sk-test-explicit';
const OPENAI_KEY = 'sk-openai-synthetic';
const BLANK_KEY = ' \n';
const CUSTOM_AUTHORIZATION = 'Custom abc';
const KEYLESS_WARNING =
  'Interfaze SDK is running in keyless mode. For higher rate limits, get an API key at https://interfaze.ai/dashboard.';
const NO_RETRIES = 0;
const SINGLE_ATTEMPT = 1;
const DAILY_RETRY_AFTER_SECONDS = 3600;
const DAILY_RESET_EPOCH_SECONDS = 1_900_000_000;

const AUTHORIZATION_SPELLINGS = ['Authorization', 'authorization'];
const HEADER_SOURCES = ['default', 'per-request'];

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

const errorFetch = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(body, {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
  );

const succeed = () =>
  vi.fn<typeof fetch>(createJsonFixtureFetchMock('interfaze-basic'));

/** The `Authorization` header of each request, in order; `null` when absent. */
const sentAuthorizations = (transport: Mock<typeof fetch>) =>
  transport.mock.calls.map(([, init]) =>
    new Headers(init?.headers).get('authorization'),
  );

type RunOptions = {
  maxRetries?: number;
  headers?: Record<string, string>;
};

const run = (model: LanguageModel, options: RunOptions = {}) =>
  generateText({ model, prompt: PROMPT, ...options });

beforeEach(() => {
  vi.stubEnv('INTERFAZE_API_KEY', undefined);
  vi.stubEnv('OPENAI_API_KEY', undefined);
  vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // Restore `process` before the env, because the env restore reads it.
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createInterfaze authentication', () => {
  it.each([
    {
      name: 'no Authorization header when only OPENAI_API_KEY is set',
      env: { OPENAI_API_KEY: OPENAI_KEY },
      apiKey: undefined,
      expected: null,
    },
    {
      name: 'INTERFAZE_API_KEY as a bearer token',
      env: { INTERFAZE_API_KEY: ENV_KEY },
      apiKey: undefined,
      expected: `Bearer ${ENV_KEY}`,
    },
    {
      name: 'an explicit apiKey over INTERFAZE_API_KEY',
      env: { INTERFAZE_API_KEY: ENV_KEY },
      apiKey: EXPLICIT_KEY,
      expected: `Bearer ${EXPLICIT_KEY}`,
    },
    {
      name: 'INTERFAZE_API_KEY when apiKey is blank',
      env: { INTERFAZE_API_KEY: ENV_KEY },
      apiKey: BLANK_KEY,
      expected: `Bearer ${ENV_KEY}`,
    },
    {
      name: 'no Authorization header when INTERFAZE_API_KEY is blank',
      env: { INTERFAZE_API_KEY: BLANK_KEY },
      apiKey: undefined,
      expected: null,
    },
  ])('sends $name', async ({ env, apiKey, expected }) => {
    Object.entries(env).forEach(([name, value]) => vi.stubEnv(name, value));
    const fetch = succeed();
    await run(createInterfaze({ apiKey, fetch })('interfaze'));

    expect(sentAuthorizations(fetch)).toEqual([expected]);
  });

  it.each(
    AUTHORIZATION_SPELLINGS.flatMap(spelling =>
      HEADER_SOURCES.map(source => ({ source, spelling })),
    ),
  )(
    'sends a $source $spelling header instead of the key, once',
    async ({ source, spelling }) => {
      const headers = { [spelling]: CUSTOM_AUTHORIZATION };
      const fetch = succeed();
      const model = createInterfaze({
        apiKey: EXPLICIT_KEY,
        fetch,
        ...(source === 'default' ? { headers } : {}),
      })('interfaze');
      await run(model, source === 'per-request' ? { headers } : {});

      expect(sentAuthorizations(fetch)).toEqual([CUSTOM_AUTHORIZATION]);
    },
  );

  it.each([
    {
      name: 'no Authorization header without a key',
      apiKey: undefined,
      expected: null,
    },
    {
      name: 'the key with a key',
      apiKey: EXPLICIT_KEY,
      expected: `Bearer ${EXPLICIT_KEY}`,
    },
  ])(
    'treats a blank caller Authorization header as unset: sends $name',
    async ({ apiKey, expected }) => {
      const fetch = succeed();
      await run(
        createInterfaze({
          apiKey,
          fetch,
          headers: { Authorization: BLANK_KEY },
        })('interfaze'),
      );

      expect(sentAuthorizations(fetch)).toEqual([expected]);
    },
  );

  it('sends no Authorization header for a blank per-request header without a key', async () => {
    const fetch = succeed();
    await run(createInterfaze({ fetch })('interfaze'), {
      headers: { Authorization: BLANK_KEY },
    });

    expect(sentAuthorizations(fetch)).toEqual([null]);
  });

  it('throws the keyless daily limit after one request, without a wait', async () => {
    const fetch = errorFetch(
      429,
      JSON.stringify(dailyLimitBody),
      dailyLimitHeaders,
    );
    const result = run(createInterfaze({ fetch })('interfaze'));

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
});

describe('default interfaze provider', () => {
  it('reads INTERFAZE_API_KEY for each request', async () => {
    const fetch = succeed();
    vi.stubGlobal('fetch', fetch);
    await run(interfaze('interfaze'));
    vi.stubEnv('INTERFAZE_API_KEY', ENV_KEY);
    await run(interfaze('interfaze'));

    expect(sentAuthorizations(fetch)).toEqual([null, `Bearer ${ENV_KEY}`]);
  });
});

describe('runtimes', () => {
  it('goes keyless when there is no process and no document', async () => {
    vi.stubGlobal('process', undefined);
    const fetch = succeed();
    await run(createInterfaze({ fetch })('interfaze'));

    expect(sentAuthorizations(fetch)).toEqual([null]);
  });

  it('requires an Authorization header in a browser with a process polyfill', async () => {
    vi.stubGlobal('document', {});
    const fetch = succeed();

    await expect(
      run(createInterfaze({ fetch })('interfaze')),
    ).rejects.toSatisfy(LoadAPIKeyError.isInstance);
    await run(
      createInterfaze({
        fetch,
        headers: { authorization: CUSTOM_AUTHORIZATION },
      })('interfaze'),
    );

    expect(sentAuthorizations(fetch)).toEqual([CUSTOM_AUTHORIZATION]);
  });

  it('requires a key in a browser without process and sends no request', async () => {
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('document', {});
    const fetch = succeed();

    await expect(
      run(createInterfaze({ fetch })('interfaze')),
    ).rejects.toSatisfy(LoadAPIKeyError.isInstance);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a key in a browser worker and sends no request', async () => {
    vi.stubGlobal('importScripts', () => {});
    const fetch = succeed();

    await expect(
      run(createInterfaze({ fetch })('interfaze')),
    ).rejects.toSatisfy(LoadAPIKeyError.isInstance);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the key from a browser worker', async () => {
    vi.stubGlobal('importScripts', () => {});
    const fetch = succeed();
    await run(createInterfaze({ apiKey: EXPLICIT_KEY, fetch })('interfaze'));

    expect(sentAuthorizations(fetch)).toEqual([`Bearer ${EXPLICIT_KEY}`]);
  });

  it('goes keyless in a Cloudflare Worker', async () => {
    vi.stubGlobal('WorkerGlobalScope', class {});
    vi.stubGlobal('ServiceWorkerGlobalScope', class {});
    const fetch = succeed();
    await run(createInterfaze({ fetch })('interfaze'));

    expect(sentAuthorizations(fetch)).toEqual([null]);
  });
});

describe('keyless warning', () => {
  // A fresh module has a fresh once-per-process flag.
  const freshCreateInterfaze = async () => {
    vi.resetModules();
    return (await import('./interfaze-provider')).createInterfaze;
  };

  it('warns once per process at the first keyless request', async () => {
    const createFresh = await freshCreateInterfaze();
    const fetch = succeed();
    const first = createFresh({ fetch })('interfaze');
    expect(console.warn).not.toHaveBeenCalled();

    await run(first);
    await run(first);
    await run(createFresh({ fetch })('interfaze'));

    expect(console.warn).toHaveBeenCalledExactlyOnceWith(KEYLESS_WARNING);
  });

  it.each([
    { name: 'an apiKey', options: { apiKey: EXPLICIT_KEY } },
    {
      name: 'an Authorization header',
      options: { headers: { Authorization: CUSTOM_AUTHORIZATION } },
    },
  ])('does not warn with $name', async ({ options }) => {
    const createFresh = await freshCreateInterfaze();
    await run(createFresh({ ...options, fetch: succeed() })('interfaze'));

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('does not warn with INTERFAZE_API_KEY', async () => {
    vi.stubEnv('INTERFAZE_API_KEY', ENV_KEY);
    const createFresh = await freshCreateInterfaze();
    await run(createFresh({ fetch: succeed() })('interfaze'));

    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('retry classification', () => {
  it.each([
    {
      name: 'a 408 with the daily-limit code',
      status: 408,
      body: JSON.stringify(dailyLimitBody),
      isRetryable: true,
    },
    {
      name: 'a 409 with the daily-limit code',
      status: 409,
      body: JSON.stringify(dailyLimitBody),
      isRetryable: true,
    },
    {
      name: 'a 500 with the daily-limit code',
      status: 500,
      body: JSON.stringify(dailyLimitBody),
      isRetryable: true,
    },
    {
      name: 'a keyless in-flight 429',
      status: 429,
      body: JSON.stringify(inflightLimitBody),
      isRetryable: true,
    },
    {
      name: 'a 429 with an unparseable body',
      status: 429,
      body: 'slow down',
      isRetryable: true,
    },
    {
      name: 'a 400',
      status: 400,
      body: JSON.stringify(invalidKeyBody),
      isRetryable: false,
    },
    {
      name: 'a 401',
      status: 401,
      body: JSON.stringify(invalidKeyBody),
      isRetryable: false,
    },
  ])(
    'sets isRetryable to $isRetryable for $name',
    async ({ status, body, isRetryable }) => {
      const fetch = errorFetch(status, body);

      await expect(
        run(createInterfaze({ fetch })('interfaze'), {
          maxRetries: NO_RETRIES,
        }),
      ).rejects.toMatchObject({ statusCode: status, isRetryable });
    },
  );
});
