import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';

// generateObject with an image — OCR runs under the hood.
const { object } = await generateObject({
  model: interfaze('interfaze-beta'),
  schema: z.object({
    merchant: z.string(),
    total: z.number(),
    items: z.array(z.object({ name: z.string(), price: z.number() })),
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

console.log(object);
