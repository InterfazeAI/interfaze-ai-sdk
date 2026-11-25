import type { ProviderErrorStructure } from '@ai-sdk/openai-compatible';
import {
  APICallError,
  LoadAPIKeyError,
  NoSuchModelError,
  type LanguageModelV4,
  type ProviderV4,
} from '@ai-sdk/provider';
import {
  loadOptionalSetting,
  withoutTrailingSlash,
  withUserAgentSuffix,
  type FetchFunction,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { InterfazeChatLanguageModel } from './interfaze-chat-language-model';
import type { InterfazeChatModelId } from './interfaze-chat-language-model-options';
import { createInterfazeMetadataExtractor } from './interfaze-metadata-extractor';
import { resolveInterfazeFileParts } from './interfaze-file-parts';
import { INTERFAZE_BASE_URL } from './constants';
import { VERSION } from './version';

// Interfaze nests errors under `error` on both paths: the JSON body built by
// `buildErrorResponse`/`formatErrorResponse`, and the SSE `event: error` chunk
// built by `handleErrorStreamingResponse`.
const interfazeErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().nullish(),
    param: z.any().nullish(),
    code: z.union([z.string(), z.number()]).nullish(),
    request_id: z.string().nullish(),
  }),
});

/** Shape of an Interfaze API error, parsed from the `error` field of a JSON body or SSE `error` chunk. */
export interface InterfazeErrorData {
  /** The error payload returned by the API. */
  error: {
    message: string;
    type?: string | null | undefined;
    param?: any;
    code?: string | number | null | undefined;
    request_id?: string | null | undefined;
  };
}

// Compile-time guard: the hand-written interface and the runtime schema must
// stay structurally identical, or this alias fails to satisfy `Assert<true>`.
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _AssertErrorDataMatchesSchema = Assert<
  Equal<InterfazeErrorData, z.infer<typeof interfazeErrorSchema>>
>;

const HTTPS_URL = /^https:\/\/.+$/;

const HTTP_TOO_MANY_REQUESTS = 429;
const KEYLESS_DAILY_LIMIT_CODE = 'keyless_daily_limit_exceeded';

// A keyless daily limit lasts for hours, so a retry cannot succeed. Every
// other error keeps the default retry rule of `APICallError`.
const isRetryableResponse = (
  response: Response,
  error?: InterfazeErrorData,
): boolean =>
  new APICallError({
    message: '',
    url: '',
    requestBodyValues: {},
    statusCode: response.status,
  }).isRetryable &&
  !(
    response.status === HTTP_TOO_MANY_REQUESTS &&
    error?.error.code === KEYLESS_DAILY_LIMIT_CODE
  );

const interfazeErrorStructure: ProviderErrorStructure<InterfazeErrorData> = {
  errorSchema: interfazeErrorSchema,
  errorToMessage: data => data.error.message,
  isRetryable: isRetryableResponse,
};

/** Serialize guardrail categories into a `<guard>…</guard>` system message. */
function injectGuardTag(
  args: Record<string, any>,
  guard: readonly string[],
): Record<string, any> {
  if (!Array.isArray(guard) || guard.length === 0) return args;
  const tag = `<guard>${guard.join(', ')}</guard>`;
  const messages = Array.isArray(args.messages) ? [...args.messages] : [];
  const systemIndex = messages.findIndex(
    (message: any) => message?.role === 'system',
  );
  if (
    systemIndex !== -1 &&
    typeof messages[systemIndex]?.content === 'string'
  ) {
    const existing = messages[systemIndex].content as string;
    messages[systemIndex] = {
      ...messages[systemIndex],
      content: existing ? `${tag}\n${existing}` : tag,
    };
  } else {
    messages.unshift({ role: 'system', content: tag });
  }
  return { ...args, messages };
}

function transformInterfazeRequestBody(
  args: Record<string, any>,
): Record<string, any> {
  let out = resolveInterfazeFileParts(args);

  if (out.guard !== undefined) {
    const { guard, ...rest } = out;
    out = injectGuardTag(rest, guard);
  }

  return out;
}

/** Configuration for {@link createInterfaze}. */
export interface InterfazeProviderSettings {
  /**
   * API key; defaults to the `INTERFAZE_API_KEY` environment variable. Without
   * either, server-side requests omit the `Authorization` header and use
   * keyless access. Browsers must set this or an `Authorization` header.
   */
  apiKey?: string;
  /** Base URL for the API; defaults to {@link INTERFAZE_BASE_URL}. */
  baseURL?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Custom `fetch` implementation, e.g. for testing or proxying. */
  fetch?: FetchFunction;
  /** Stream `<precontext>` deltas as they're produced (`x-show-additional-info`). */
  showAdditionalInfo?: boolean;
  /** Skip the mixture-of-agents router (`x-interfaze-bypass-moa`). */
  bypassMoA?: boolean;
  /** Skip the semantic cache (`x-interfaze-bypass-cache`). */
  bypassCache?: boolean;
}

/** Interfaze provider: call it directly or via {@link InterfazeProvider.languageModel} / {@link InterfazeProvider.chat} to create a chat model. */
export interface InterfazeProvider extends ProviderV4 {
  (modelId: InterfazeChatModelId): LanguageModelV4;
  /** Create a chat language model for the given model id. */
  languageModel(modelId: InterfazeChatModelId): LanguageModelV4;
  /** Alias for {@link InterfazeProvider.languageModel}. */
  chat(modelId: InterfazeChatModelId): LanguageModelV4;
  /** Not supported by Interfaze; throws `NoSuchModelError`. */
  textEmbeddingModel(modelId: string): never;
}

const nonBlank = (value: string | undefined): string | undefined =>
  value?.trim() || undefined;

/**
 * Resolves the API key: a nonblank `apiKey` wins over a nonblank
 * `INTERFAZE_API_KEY`. Runtimes without `process` have no environment key.
 */
const resolveApiKey = (apiKey: string | undefined): string | undefined =>
  nonBlank(apiKey) ??
  nonBlank(
    loadOptionalSetting({
      settingValue: undefined,
      environmentVariableName: 'INTERFAZE_API_KEY',
    }),
  );

// Browser workers define `importScripts`. Cloudflare Workers define
// `WorkerGlobalScope` but not `importScripts`, and they stay keyless.
const isBrowserRuntime = (): boolean =>
  'document' in globalThis ||
  typeof Reflect.get(globalThis, 'importScripts') === 'function';

const KEYLESS_WARNING =
  'Interfaze SDK is running in keyless mode. For higher rate limits, get an API key at https://interfaze.ai/dashboard.';

// Records whether this process has shown the keyless warning.
const keylessWarning = { shown: false };

// Warns at the first keyless request of the process.
const warnKeyless = (): void => {
  if (keylessWarning.shown) return;
  keylessWarning.shown = true;
  console.warn(KEYLESS_WARNING);
};

/**
 * Wraps `fetch` at send time. It appends this package's user-agent token.
 * Putting the token in the provider's static headers does not work: the AI SDK
 * core sets its own `user-agent` on the per-call headers, which win the header
 * merge and silently replace anything the provider configured.
 *
 * It also guards browsers. The API rejects keyless browser calls, so a request
 * without an `Authorization` header fails here with `LoadAPIKeyError` in a page
 * or a browser worker, even if a bundler polyfills `process`. The header can
 * come from the key, from `headers` or from the per-request headers.
 */
function withInterfazeFetch(base?: FetchFunction): FetchFunction {
  return async (input, init) => {
    const headers = withUserAgentSuffix(
      init?.headers ?? {},
      `@interfaze-ai/ai-sdk/${VERSION}`,
    );
    if (!headers.authorization && isBrowserRuntime()) {
      throw new LoadAPIKeyError({
        message:
          'Interfaze does not accept keyless requests from a browser. Pass an API key: `createInterfaze({ apiKey })`.',
      });
    }
    if (!headers.authorization) warnKeyless();
    return (base ?? globalThis.fetch)(input, { ...init, headers });
  };
}

/**
 * Create an {@link InterfazeProvider} bound to the given settings.
 *
 * @param options - Provider settings such as `apiKey`, `baseURL`, and header toggles.
 * @returns A provider that creates Interfaze chat models.
 *
 * @example
 * ```ts
 * import { createInterfaze } from '@interfaze-ai/ai-sdk';
 * import { generateText } from 'ai';
 *
 * const interfaze = createInterfaze({ apiKey: process.env.INTERFAZE_API_KEY });
 * const { text } = await generateText({
 *   model: interfaze('interfaze'),
 *   prompt: 'Hello!',
 * });
 * ```
 */
export function createInterfaze(
  options: InterfazeProviderSettings = {},
): InterfazeProvider {
  const baseURL = withoutTrailingSlash(options.baseURL ?? INTERFAZE_BASE_URL);
  // Resolves the key for each request. A caller `Authorization` header in
  // `headers` or in the per-request headers replaces the key header.
  const getHeaders = () => {
    const apiKey = resolveApiKey(options.apiKey);
    return {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(options.showAdditionalInfo
        ? { 'x-show-additional-info': 'true' }
        : {}),
      ...(options.bypassMoA ? { 'x-interfaze-bypass-moa': 'true' } : {}),
      ...(options.bypassCache ? { 'x-interfaze-bypass-cache': 'true' } : {}),
      ...options.headers,
    };
  };

  const createLanguageModel = (modelId: InterfazeChatModelId) => {
    return new InterfazeChatLanguageModel(modelId, {
      provider: `interfaze.chat`,
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: withInterfazeFetch(options.fetch),
      errorStructure: interfazeErrorStructure,
      supportsStructuredOutputs: true,
      // Interfaze only sends the streaming usage frame when include_usage is set.
      includeUsage: true,
      transformRequestBody: transformInterfazeRequestBody,
      metadataExtractor: createInterfazeMetadataExtractor(),
      // Interfaze fetches attachment URLs server-side (and sniffs the real
      // media type off the bytes), so URLs are forwarded rather than
      // downloaded and re-encoded as base64 here. `text/*` is left off: the
      // converter inlines those as text parts, which needs no fetch at all.
      supportedUrls: () => ({
        'image/*': [HTTPS_URL],
        'audio/*': [HTTPS_URL],
        'video/*': [HTTPS_URL],
        'application/*': [HTTPS_URL],
      }),
    });
  };

  const provider = (modelId: InterfazeChatModelId) =>
    createLanguageModel(modelId);

  provider.specificationVersion = 'v4' as const;
  provider.languageModel = createLanguageModel;
  provider.chat = createLanguageModel;

  provider.embeddingModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
  };
  provider.textEmbeddingModel = provider.embeddingModel;
  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
  };

  return provider;
}

/**
 * Default provider instance. It reads `INTERFAZE_API_KEY` for each request and
 * uses keyless access when the variable is unset.
 */
export const interfaze: InterfazeProvider = createInterfaze();
