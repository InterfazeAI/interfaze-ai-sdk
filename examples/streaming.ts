import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { streamText } from 'ai';

// The inline <think>/<precontext> side-channels are stripped from the visible
// stream and returned on providerMetadata when it finishes.
const { textStream, providerMetadata } = streamText({
  model: interfaze('interfaze-beta'),
  prompt: "Summarize this week's top AI research and cite your sources.",
});

for await (const delta of textStream) process.stdout.write(delta);

const meta = await providerMetadata;
console.log('\n---');
console.log('precontext:', meta?.interfaze?.precontext);
console.log('reasoning:', meta?.interfaze?.reasoning);
