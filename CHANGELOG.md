# Changelog

All notable changes to `@interfaze-ai/ai-sdk-provider` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0]

Initial release — community [AI SDK](https://ai-sdk.dev) provider for [Interfaze](https://interfaze.ai).

### Added

- `createInterfaze` / `interfaze` provider for `generateText` / `streamText` / `generateObject` / `streamObject` (`LanguageModelV4`, built on `@ai-sdk/openai-compatible`).
- `providerMetadata.interfaze`: `vcache` (semantic-cache hit), `reasoning`, and internal-task `precontext`.
- `providerOptions.interfaze`: `reasoningEffort` (incl. Interfaze's `on` / `off` / `auto`), `guard` (guardrail categories, serialized to a `<guard>` system message), and `precontext` passthrough.
- Client options `showAdditionalInfo`, `bypassMoA`, `bypassCache` → the `x-interfaze-*` control headers.
- Server-side multimodal URL handling for images, PDFs, and video.
