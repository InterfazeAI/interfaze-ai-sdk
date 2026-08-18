import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { generateText } from 'ai';

// reads INTERFAZE_API_KEY from the environment
const { text, providerMetadata } = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'In one sentence, what is Interfaze?',
});

console.log(text);
console.log('cache hit:', providerMetadata?.interfaze?.vcache);
