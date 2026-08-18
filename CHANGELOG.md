# Changelog

All notable changes to `@interfaze-ai/ai-sdk` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.1]

### Fixed

- `VERSION` reported `0.0.0-test` to JSR consumers. It was injected at build time by tsup, but JSR publishes the raw sources with no build step, so the fallback always won. It's now a plain literal, checked against package.json and jsr.json in CI.

### Added

- `description` and `runtimeCompat` in jsr.json (Node, Deno, Bun, browser, workerd) — both count toward the JSR score, and neither is inferred from package.json.

## [1.0.0]

Initial release — community [AI SDK](https://ai-sdk.dev) provider for [Interfaze](https://interfaze.ai).

### Added

- `createInterfaze` / `interfaze` provider for `generateText` / `streamText` / `generateObject` / `streamObject` (`LanguageModelV4`, built on `@ai-sdk/openai-compatible`).
- `providerMetadata.interfaze`: `vcache` (semantic-cache hit), `reasoning`, and internal-task `precontext`.
- `providerOptions.interfaze`: `reasoningEffort` (incl. Interfaze's `on` / `off` / `auto`) and `guard` (guardrail categories, serialized to a `<guard>` system message).
- Client options `showAdditionalInfo`, `bypassMoA`, `bypassCache` → the `x-interfaze-*` control headers.
- Multimodal input for every media type Interfaze accepts — image, audio, video, PDF, `.docx`, and text/JSON/XML/YAML documents. Public URLs are forwarded for Interfaze to fetch server-side instead of being downloaded and re-encoded as base64.
