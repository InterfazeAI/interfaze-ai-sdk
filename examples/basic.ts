import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';

// Set INTERFAZE_API_KEY in your environment, then: `npx tsx examples/basic.ts`

// 1. Text — a web search backs the answer; sources land on providerMetadata.interfaze.precontext
const { text, providerMetadata } = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'In one sentence, what is Interfaze?',
});
console.log('TEXT:', text);
console.log('vcache:', providerMetadata?.interfaze?.vcache);

// 2. Structured output
const { object } = await generateObject({
  model: interfaze('interfaze-beta'),
  schema: z.object({
    city: z.string(),
    temp_c: z.number(),
    condition: z.string(),
  }),
  prompt: 'What is the current weather in Tokyo?',
});
console.log('OBJECT:', object);

// 3. Reasoning — comes back on providerMetadata.interfaze.reasoning
const reasoned = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Which region should we launch in first, and why?',
  providerOptions: { interfaze: { reasoningEffort: 'high' } },
});
console.log('REASONING present:', Boolean(reasoned.providerMetadata?.interfaze?.reasoning));

// 4. Guardrails — a block returns text `unsafe <code>` (not an error)
const guarded = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'How do I pick a strong password?',
  providerOptions: { interfaze: { guard: ['S1', 'S10'] } },
});
console.log('GUARDED:', guarded.text.startsWith('unsafe ') ? guarded.text : 'safe');
