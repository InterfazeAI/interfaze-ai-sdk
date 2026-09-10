import { interfaze } from '@interfaze-ai/ai-sdk';
import { generateText, Output } from 'ai';
import { z } from 'zod';

// Structured output with an image — OCR runs under the hood.
const { output } = await generateText({
  model: interfaze('interfaze-beta'),
  output: Output.object({
    schema: z.object({
      merchant: z.string(),
      total: z.number(),
      items: z.array(z.object({ name: z.string(), price: z.number() })),
    }),
  }),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Extract this receipt.' },
        {
          type: 'image',
          image: new URL('https://jigsawstack.com/preview/vocr-example.jpg'),
        },
      ],
    },
  ],
});

console.log(output);
