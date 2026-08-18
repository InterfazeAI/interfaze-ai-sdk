import { interfaze } from '@interfaze-ai/ai-sdk';
import { APICallError, generateText } from 'ai';

// Interfaze errors surface as the AI SDK's APICallError, carrying the HTTP
// status and the raw response body.
try {
  await generateText({
    model: interfaze('interfaze-beta'),
    prompt: 'hi',
    temperature: 2, // out of range → API 400
  });
} catch (error) {
  if (APICallError.isInstance(error)) {
    console.log('status:', error.statusCode);
    console.log('body:', error.responseBody);
  } else {
    throw error;
  }
}
