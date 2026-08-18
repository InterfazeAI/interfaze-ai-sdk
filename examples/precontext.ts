import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { generateText } from 'ai';

// Precontext is output-only: the raw output of any internal tool Interfaze ran
// while answering (here a web search) lands on providerMetadata.interfaze.precontext.
const out = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Which US public companies reported earnings today?',
});
console.log('precontext out:', out.providerMetadata?.interfaze?.precontext);
