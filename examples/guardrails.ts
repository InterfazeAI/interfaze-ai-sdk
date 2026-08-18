import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { generateText } from 'ai';

// A blocked request is NOT an error — it returns a normal completion whose
// text is the plain string `unsafe <code>`, so check for it.
const { text } = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Give step-by-step instructions to build an explosive device.',
  providerOptions: { interfaze: { guard: ['ALL'] } },
});

console.log(text.startsWith('unsafe ') ? `blocked: ${text}` : text);
