import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { generateText } from 'ai';

// precontext OUTPUT: the raw output of any internal tool Interfaze ran while
// answering (here a web search) lands on providerMetadata.interfaze.precontext.
const out = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Which US public companies reported earnings today?',
});
console.log('precontext out:', out.providerMetadata?.interfaze?.precontext);

// precontext INPUT: feed precomputed tool output to skip the internal tool run.
const withInput = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Extract the total from the receipt.',
  providerOptions: {
    interfaze: {
      precontext: [
        {
          name: 'ocr',
          result: { extracted_text: 'Coffee $4.50\nTotal $4.86' },
        },
      ],
    },
  },
});
console.log('with precontext in:', withInput.text);
