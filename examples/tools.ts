import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { generateText, tool } from 'ai';
import { z } from 'zod';

// Interfaze routes through a mixture-of-agents router, so give an explicit
// instruction when you need a specific tool invoked.
const { text, toolResults } = await generateText({
  model: interfaze('interfaze-beta'),
  tools: {
    weather: tool({
      description: 'Get the current weather for a location',
      inputSchema: z.object({ location: z.string() }),
      execute: async ({ location }) => ({ location, temperatureF: 72 }),
    }),
  },
  prompt: 'Use the weather tool to get the weather in San Francisco.',
});

console.log('tool results:', toolResults);
console.log('text:', text);
