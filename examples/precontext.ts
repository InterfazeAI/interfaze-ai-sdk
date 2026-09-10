import { interfaze } from '@interfaze-ai/ai-sdk';
import { generateText } from 'ai';

// Precontext is output-only: the raw output of any internal tool Interfaze ran
// while answering (here a web search) lands on
// finalStep.providerMetadata.interfaze.precontext.
const out = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Which US public companies reported earnings today?',
});
console.log(
  'precontext out:',
  out.finalStep.providerMetadata?.interfaze?.precontext,
);
