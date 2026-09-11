import type { ProviderErrorStructure } from '@ai-sdk/openai-compatible';
import {
  NoSuchModelError,
  type LanguageModelV4,
  type ProviderV4,
} from '@ai-sdk/provider';
import {
  loadApiKey,
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

const interfazeErrorStructure: ProviderErrorStructure<InterfazeErrorData> = {
  errorSchema: interfazeErrorSchema,
  errorToMessage: data => data.error.message,
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
  /** API key; defaults to the `INTERFAZE_API_KEY` environment variable. */
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
 *   model: interfaze('interfaze-beta'),
 *   prompt: 'Hello!',
 * });
 * ```
 */
/**
 * Appends this package's user-agent token at send time. Putting it in the
 * provider's static headers does not work: the AI SDK core sets its own
 * `user-agent` on the per-call headers, which win the header merge and
 * silently replace anything the provider configured.
 */
function withInterfazeUserAgent(base?: FetchFunction): FetchFunction {
  return (input, init) => {
    const headers = withUserAgentSuffix(
      init?.headers ?? {},
      `@interfaze-ai/ai-sdk/${VERSION}`,
    );
    return (base ?? globalThis.fetch)(input, { ...init, headers });
  };
}

export function createInterfaze(
  options: InterfazeProviderSettings = {},
): InterfazeProvider {
  const baseURL = withoutTrailingSlash(options.baseURL ?? INTERFAZE_BASE_URL);
  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: 'INTERFAZE_API_KEY',
      description: 'Interfaze API key',
    })}`,
    ...(options.showAdditionalInfo ? { 'x-show-additional-info': 'true' } : {}),
    ...(options.bypassMoA ? { 'x-interfaze-bypass-moa': 'true' } : {}),
    ...(options.bypassCache ? { 'x-interfaze-bypass-cache': 'true' } : {}),
    ...options.headers,
  });

  const createLanguageModel = (modelId: InterfazeChatModelId) => {
    return new InterfazeChatLanguageModel(modelId, {
      provider: `interfaze.chat`,
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: withInterfazeUserAgent(options.fetch),
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

/** Default provider instance, configured from the environment (`INTERFAZE_API_KEY`). */
export const interfaze: InterfazeProvider = createInterfaze();
