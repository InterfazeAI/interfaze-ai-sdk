# Examples

Runnable snippets. Install the package and set your key first:

```bash
npm install @interfaze-ai/ai-sdk-provider ai zod
export INTERFAZE_API_KEY="sk_..."
npx tsx examples/quickstart.ts
```

- `quickstart.ts` — first request (`generateText`) + `vcache`
- `streaming.ts` — `streamText` with precontext / reasoning at finish
- `structured-output.ts` — `generateObject` with a Zod schema (image OCR)
- `tools.ts` — function calling (tool round-trip)
- `reasoning.ts` — `reasoningEffort` → `providerMetadata.interfaze.reasoning`
- `guardrails.ts` — `guard` categories; a block returns `unsafe <code>`
- `multimodal.ts` — image, audio, PDF, and video content parts
- `precontext.ts` — precontext output (the internal tools Interfaze ran)
- `errors.ts` — catching and narrowing `APICallError`
