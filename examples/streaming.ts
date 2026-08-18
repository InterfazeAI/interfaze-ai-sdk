import { createInterfaze } from '@interfaze-ai/ai-sdk-provider';
import { streamText } from 'ai';

// The inline <think>/<precontext> side-channels are stripped from the visible
// stream; reasoning is attached to providerMetadata when it finishes.
// Streamed precontext is only emitted when showAdditionalInfo is set — without
// it, providerMetadata.interfaze.precontext is undefined at finish.
const interfaze = createInterfaze({ showAdditionalInfo: true });

const { textStream, providerMetadata } = streamText({
  model: interfaze('interfaze-beta'),
  prompt: "Summarize this week's top AI research and cite your sources.",
});

for await (const delta of textStream) process.stdout.write(delta);

const meta = await providerMetadata;
console.log('\n---');
console.log('precontext:', meta?.interfaze?.precontext);
console.log('reasoning:', meta?.interfaze?.reasoning);
