# Examples

Runnable snippets. Install the package and set your key first:

```bash
npm install @interfaze-ai/ai-sdk ai zod
export INTERFAZE_API_KEY="sk_..."
npx tsx examples/quickstart.ts
```

- `quickstart.ts` — first request (`generateText`) + `vcache`
- `streaming.ts` — `streamText` with precontext / reasoning at finish
- `structured-output.ts` — `generateText` + `Output.object` with a Zod schema (image OCR)
- `tools.ts` — function calling (tool round-trip)
- `reasoning.ts` — `reasoningEffort` → `finalStep.providerMetadata.interfaze.reasoning`
- `guardrails.ts` — `guard` categories; a block returns `unsafe <code>`
- `multimodal.ts` — image, audio, PDF, and video content parts
- `precontext.ts` — precontext output (the internal tools Interfaze ran)
- `errors.ts` — catching and narrowing `APICallError`
- `keyless.ts` — a server-side request without a key (run with `INTERFAZE_API_KEY` unset). Keyless access needs a release of `@interfaze-ai/ai-sdk` later than 1.0.3. See the [changelog](../CHANGELOG.md).
