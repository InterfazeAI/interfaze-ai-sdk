import { interfaze } from '@interfaze-ai/ai-sdk';
import { generateText } from 'ai';

// Run on a server with INTERFAZE_API_KEY unset: the request goes out without
// an Authorization header and counts against the keyless limits.
const { text } = await generateText({
  model: interfaze('interfaze'),
  prompt: 'In one sentence, what is Interfaze?',
});

console.log(text);
