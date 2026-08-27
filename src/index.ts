/**
 * Community [Vercel AI SDK](https://ai-sdk.dev)  provider for
 * [Interfaze](https://interfaze.ai).
 *
 * @example
 * ```ts
 * import { interfaze } from '@interfaze-ai/ai-sdk-provider';
 * import { generateText } from 'ai';
 *
 * const { text } = await generateText({
 *   model: interfaze('interfaze-beta'),
 *   prompt: 'Write a haiku about TypeScript.',
 * });
 * ```
 *
 * @module
 */
export { createInterfaze, interfaze } from './interfaze-provider';
export type {
  InterfazeProvider,
  InterfazeProviderSettings,
} from './interfaze-provider';
export type { InterfazeErrorData } from './interfaze-provider';
export type {
  InterfazeChatModelId,
  InterfazeLanguageModelChatOptions,
} from './interfaze-chat-language-model-options';
export { INTERFAZE_BASE_URL, INTERFAZE_MODEL } from './constants';
export { VERSION } from './version';
