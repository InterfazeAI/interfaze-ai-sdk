# Interfaze provider for the AI SDK

The community [AI SDK](https://ai-sdk.dev/docs) provider for [Interfaze](https://interfaze.ai) — an LLM built for developers and automations.

[Docs](https://interfaze.ai/docs) · [limits](https://interfaze.ai/docs/limits) · [pricing](https://interfaze.ai/pricing) · [dashboard](https://interfaze.ai) · [TypeScript SDK](https://github.com/InterfazeAI/interfaze-js) · [Python SDK](https://github.com/InterfazeAI/interfaze-python)

It brings Interfaze to the standard `generateText` / `streamText` / `generateObject` surface, and surfaces Interfaze's extras — the semantic-cache flag, reasoning, and internal-task `precontext` — on `providerMetadata`.

> Community provider, maintained by Interfaze. For the list of first-party providers see the [AI SDK docs](https://ai-sdk.dev/providers/ai-sdk-providers); for community providers, the [community list](https://ai-sdk.dev/providers/community-providers).

## Install

```bash
npm install @interfaze-ai/ai-sdk
# or: yarn add · pnpm add · bun add @interfaze-ai/ai-sdk
```

Set `INTERFAZE_API_KEY` in your environment (or pass `apiKey` to `createInterfaze`). Get a key from the [Interfaze dashboard](https://interfaze.ai).

## Setup

Import the default `interfaze` instance, or build one with `createInterfaze`:

```ts
import { createInterfaze, interfaze } from '@interfaze-ai/ai-sdk';

interfaze('interfaze-beta'); // default, reads INTERFAZE_API_KEY

const custom = createInterfaze({ apiKey: 'sk_...' });
```

## Your first request

Drop an image into the prompt and get a typed object back — Interfaze runs OCR under the hood and hands you both the structured result and the raw OCR that produced it:

```ts
import { interfaze } from '@interfaze-ai/ai-sdk';
import { generateObject } from 'ai';
import { z } from 'zod';

const { object, providerMetadata } = await generateObject({
  model: interfaze('interfaze-beta'),
  schema: z.object({
    first_name: z.string(),
    last_name: z.string(),
    dob: z.string().describe('Date of birth on the ID'),
    licence_number: z.string(),
  }),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Extract the details from this ID.' },
        {
          type: 'image',
          image: new URL(
            'https://r2public.jigsawstack.com/interfaze/examples/id.jpg',
          ),
        },
      ],
    },
  ],
});

console.log(object); // { first_name, last_name, dob, licence_number }
console.log('OCR result:', providerMetadata?.interfaze?.precontext?.[0]); // the raw OCR
```

## Precontext

Alongside the answer, a response carries `precontext` — the raw output of any internal tool Interfaze ran while answering (OCR, web search, scrape, transcription, …). It lands on `providerMetadata.interfaze.precontext`:

```ts
const { text, providerMetadata } = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Which US public companies reported earnings today?',
});

for (const p of providerMetadata?.interfaze?.precontext ?? []) {
  console.log(p); // e.g. { name: "search", result: { … } }
}
```

Precontext is output-only — it reports what Interfaze did while answering. There is no way to feed it back in.

## Text

```ts
import { interfaze } from '@interfaze-ai/ai-sdk';
import { generateText } from 'ai';

const { text } = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Which US public companies reported earnings today?',
});
```

A web search backs the answer here — the sources land on `providerMetadata.interfaze.precontext`.

### Streaming

`streamText` streams the reply as it's generated; the inline `<think>` / `<precontext>` side-channels are stripped from the visible text, and `reasoning` is attached to `providerMetadata` when the stream finishes. Streamed `precontext` is only emitted when the provider is created with `showAdditionalInfo: true` (see [Client options](#client-options)); otherwise it's `undefined` at finish.

```ts
const interfaze = createInterfaze({ showAdditionalInfo: true }); // for streamed precontext

const { textStream, providerMetadata } = streamText({
  model: interfaze('interfaze-beta'),
  prompt: "Summarize this week's top AI research and cite your sources.",
});

for await (const delta of textStream) process.stdout.write(delta);

const meta = await providerMetadata; // meta?.interfaze?.reasoning; .precontext when showAdditionalInfo is set
```

## Structured output

Interfaze supports structured outputs, so `generateObject` / `streamObject` work with a Zod schema:

```ts
import { interfaze } from '@interfaze-ai/ai-sdk';
import { generateObject } from 'ai';
import { z } from 'zod';

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
```

## Tools

Interfaze supports tools — define them and the AI SDK runs the usual tool loop:

```ts
import { interfaze } from '@interfaze-ai/ai-sdk';
import { generateText, tool } from 'ai';
import { z } from 'zod';

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
```

> Interfaze routes requests through a mixture-of-agents router that decides whether to call a user tool or answer directly from its own live data, so `tool_choice` is advisory. Give an explicit instruction when you need a specific tool invoked.

## Reasoning

Set `reasoningEffort` (`'minimal' | 'low' | 'medium' | 'high'`, plus Interfaze's `'on' | 'off' | 'auto'`); the reasoning text comes back on `providerMetadata.interfaze.reasoning`:

```ts
const { text, providerMetadata } = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'Which region should we launch in first, and why?',
  providerOptions: { interfaze: { reasoningEffort: 'high' } },
});

providerMetadata?.interfaze?.reasoning; // string | undefined
```

A semantic-cache hit replays a stored answer without reasoning — set `bypassCache: true` on the provider (see [Client options](#client-options)) when you need fresh reasoning every call.

## Multimodal

Images, audio, video and documents all use standard AI SDK content parts. Pass a public URL — Interfaze fetches it server-side, so nothing is downloaded and re-encoded on the way out — or raw bytes:

Supported media types:

| Kind      | Types                                                                                        |
| --------- | -------------------------------------------------------------------------------------------- |
| Image     | `image/jpeg` `image/png` `image/webp` `image/bmp` `image/heic` `image/heif`                  |
| Audio     | `audio/wav` `audio/mpeg` `audio/mp4` `audio/ogg` `audio/flac`                                |
| Video     | `video/mp4` `video/quicktime` `video/webm` `video/3gpp` `video/x-msvideo` `video/x-matroska` |
| Documents | `application/pdf`, `.docx`, `application/json` `application/xml` `application/yaml`          |
| Text      | `text/plain` `text/csv` `text/markdown` `text/tab-separated-values`                          |

`image/gif` and `image/avif` are rejected by the API.

```ts
await generateText({
  model: interfaze('interfaze-beta'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Summarize this document.' },
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: new URL('https://arxiv.org/pdf/1706.03762'),
        },
      ],
    },
  ],
});
```

Video is a `file` part with a `video/*` media type; Interfaze reads the URL server-side:

```ts
{ type: "file", mediaType: "video/mp4", data: new URL("https://…/clip.mp4") }
```

## Guardrails

Enable safety categories with `guard`; a blocked request comes back as a normal completion whose text is the plain string `unsafe <code>` (not an error), so check for it:

```ts
const { text } = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: '...',
  providerOptions: { interfaze: { guard: ['S1', 'S10', 'S12_IMAGE'] } },
});

if (text.startsWith('unsafe ')) {
  // blocked — text is e.g. "unsafe S1"
}
```

Codes are `S1`–`S14`, the image-only `S1_IMAGE` / `S12_IMAGE` / `S15_IMAGE`, and `ALL` (enables everything).

## Interfaze metadata

Interfaze returns fields a plain chat provider drops. They land on `providerMetadata.interfaze` for both `generateText` and `streamText`:

```ts
const result = await generateText({
  model: interfaze('interfaze-beta'),
  prompt: 'What is the weather in San Francisco?',
});

result.providerMetadata?.interfaze?.vcache; // boolean — semantic-cache hit
result.providerMetadata?.interfaze?.reasoning; // string | undefined
result.providerMetadata?.interfaze?.precontext; // unknown[] | undefined — OCR / web / scrape / … output
```

## Client options

Router, cache, and streaming behavior are set once on the provider:

```ts
const interfaze = createInterfaze({
  showAdditionalInfo: true, // stream <precontext> deltas as they're produced
  bypassMoA: true, // skip the mixture-of-agents router
  bypassCache: true, // skip the semantic cache
});
```

> **Zero data retention (ZDR)** is configured at the account/infrastructure level, not via a per-request flag or client header — contact Interfaze to enable it for your account.

## Errors

Interfaze errors surface as the AI SDK's `APICallError`, carrying the HTTP status and response body:

```ts
import { APICallError } from 'ai';

try {
  await generateText({ model: interfaze('interfaze-beta'), prompt: '...' });
} catch (error) {
  if (APICallError.isInstance(error)) {
    error.statusCode; // e.g. 400, 401, 429
    error.responseBody; // raw Interfaze error payload
  }
}
```

## Capabilities

| Use case                                | Entry point                                 |
| --------------------------------------- | ------------------------------------------- |
| [Text](#text)                           | `generateText`                              |
| [Streaming](#streaming)                 | `streamText`                                |
| [Structured output](#structured-output) | `generateObject` / `streamObject`           |
| [Tools](#tools)                         | `tools`                                     |
| [Reasoning](#reasoning)                 | `providerOptions.interfaze.reasoningEffort` |
| [Multimodal](#multimodal)               | `image` / `file` content parts              |
| [Guardrails](#guardrails)               | `providerOptions.interfaze.guard`           |
| [Precontext](#precontext)               | `providerMetadata.interfaze.precontext`     |
| [Semantic cache](#interfaze-metadata)   | `providerMetadata.interfaze.vcache`         |

## Examples

Runnable snippets in [`examples/`](./examples) — one per feature (quickstart, streaming, structured output, tools, reasoning, guardrails, multimodal, precontext, errors). Set `INTERFAZE_API_KEY`, then `npx tsx examples/quickstart.ts`.

## Documentation

- [Interfaze docs](https://interfaze.ai/docs)
- [AI SDK community providers](https://ai-sdk.dev/providers/community-providers)

## License

MIT
