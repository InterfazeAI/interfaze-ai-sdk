import { interfaze } from '@interfaze-ai/ai-sdk';
import { APICallError, generateText, RetryError } from 'ai';

// Interfaze errors surface as the AI SDK's APICallError, carrying the HTTP
// status and the raw response body. When the AI SDK retries a 429 or a 5xx
// error and the last retry fails, it throws a RetryError that holds the
// APICallError in `lastError`.
try {
  await generateText({
    model: interfaze('interfaze'),
    prompt: 'hi',
    temperature: 2, // out of range → API 400
  });
} catch (error) {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(cause)) {
    console.log('status:', cause.statusCode);
    console.log('body:', cause.responseBody);
  } else {
    throw error;
  }
}
