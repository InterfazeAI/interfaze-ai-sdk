import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { generateText } from 'ai';

// reasoningEffort accepts 'minimal' | 'low' | 'medium' | 'high', plus
// Interfaze's 'on' | 'off' | 'auto'. The reasoning text comes back on
// providerMetadata.interfaze.reasoning.
const { text, providerMetadata } = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Which region should we launch in first, and why?',
  providerOptions: { interfaze: { reasoningEffort: 'high' } },
});

console.log('answer:', text);
console.log('reasoning:', providerMetadata?.interfaze?.reasoning);
