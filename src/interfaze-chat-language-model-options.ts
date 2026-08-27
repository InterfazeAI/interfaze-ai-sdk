import { z } from 'zod/v4';
import type { INTERFAZE_MODEL } from './constants';

/** Interfaze chat model id — {@link INTERFAZE_MODEL} or any other model string the API accepts. */
export type InterfazeChatModelId = typeof INTERFAZE_MODEL | (string & {});

/** Guardrail categories (`ALL` enables everything). */
export const interfazeGuardCodes = [
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
  'S6',
  'S7',
  'S8',
  'S9',
  'S10',
  'S11',
  'S12',
  'S13',
  'S14',
  'S1_IMAGE',
  'S12_IMAGE',
  'S15_IMAGE',
  'ALL',
] as const;

export const interfazeLanguageModelChatOptions = z.object({
  /** Enable guardrail categories; a match returns `unsafe <code>` as the message content. */
  guard: z.array(z.enum(interfazeGuardCodes)).optional(),
  /** Reasoning effort; also accepts Interfaze's `on` / `off` / `auto`. */
  reasoningEffort: z
    .enum(['minimal', 'low', 'medium', 'high', 'on', 'off', 'auto'])
    .optional(),
});

/** Interfaze-specific call options, passed via `providerOptions.interfaze`. */
export interface InterfazeLanguageModelChatOptions {
  /** Enable guardrail categories; a match returns `unsafe <code>` as the message content. */
  guard?: (
    | 'S1'
    | 'S2'
    | 'S3'
    | 'S4'
    | 'S5'
    | 'S6'
    | 'S7'
    | 'S8'
    | 'S9'
    | 'S10'
    | 'S11'
    | 'S12'
    | 'S13'
    | 'S14'
    | 'S1_IMAGE'
    | 'S12_IMAGE'
    | 'S15_IMAGE'
    | 'ALL'
  )[];
  /** Reasoning effort; also accepts Interfaze's `on` / `off` / `auto`. */
  reasoningEffort?:
    'minimal' | 'low' | 'medium' | 'high' | 'on' | 'off' | 'auto';
}

// Compile-time guard: the hand-written interface and the runtime schema must
// stay structurally identical, or this alias fails to satisfy `Assert<true>`.
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _AssertChatOptionsMatchSchema = Assert<
  Equal<
    InterfazeLanguageModelChatOptions,
    z.infer<typeof interfazeLanguageModelChatOptions>
  >
>;
