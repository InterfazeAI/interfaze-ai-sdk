import { interfaze } from '@interfaze-ai/ai-sdk';
import { generateText } from 'ai';

// reasoningEffort accepts 'minimal' | 'low' | 'medium' | 'high', plus
// Interfaze's 'on' | 'off' | 'auto'. The reasoning text comes back on
// finalStep.providerMetadata.interfaze.reasoning.
const { text, finalStep } = await generateText({
  model: interfaze('interfaze'),
  prompt: 'Which region should we launch in first, and why?',
  providerOptions: { interfaze: { reasoningEffort: 'high' } },
});

console.log('answer:', text);
console.log('reasoning:', finalStep.providerMetadata?.interfaze?.reasoning);
