# Changelog

All notable changes to `@interfaze-ai/ai-sdk` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.2]

Moves the documented call surface onto the AI SDK v7 APIs, hardens the file-part
sentinel, and adds CI guards so neither can drift again.

### Breaking

- Minimum runtime is now Node 22 (`engines.node` `>=22`). Node 18 is end-of-life and every `@ai-sdk/*` runtime dependency already requires `>=22`, Installing on Node 18 or 20 now reports `EBADENGINE`.

### Security

- The internal file-part sentinel was a fixed, published constant, so any text that ended up in a prompt (a scraped page, a pasted document) could impersonate it and smuggle an attacker-chosen file part — including a URL Interfaze fetches server-side — into the request. The sentinel now carries a nonce that is random per process and never observable outside it, which makes it unforgeable. The nonce is built from `crypto.getRandomValues` (available in every runtime, including non-secure browser contexts) and derived lazily, so importing the package never evaluates `crypto`.

### Fixed

- Malformed or unrecognized `providerOptions.interfaze` values now fail fast with `InvalidArgumentError` instead of being dropped silently. Previously `guard: 'ALL'` (string instead of array) or a typo'd key like `gaurd` was stripped by validation, reached the request body via the OpenAI-compatible passthrough, and injected no `<guard>` message — a silent guardrail bypass.
- The `@interfaze-ai/ai-sdk/<version>` user-agent token never reached the wire: the AI SDK core sets its own `user-agent` on per-call headers, which win the header merge. The token is now appended at send time in a fetch wrapper, preserving the core SDK's tokens.

### Changed

- The canonical model id is now `interfaze` (matching the current Interfaze docs), replacing `interfaze-beta` in `INTERFAZE_MODEL`, the examples, and the docs. `InterfazeChatModelId` still accepts any string the API takes, so existing `interfaze('interfaze-beta')` calls keep compiling.
- Documentation and examples now read provider metadata from `finalStep.providerMetadata` rather than the result's top-level `providerMetadata`, which AI SDK v7 deprecates on `generateText` / `streamText`. `generateObject` / `streamObject` are likewise replaced with `generateText` / `streamText` plus an `Output` spec, and image inputs use a `file` content part with `mediaType: 'image/*'` instead of the deprecated `image` part (v7 logs a deprecation warning for it). The request Interfaze receives is unchanged in every case.

### Added

- `pnpm check:deprecations` — fails CI when `src/`, `examples/`, `scripts/` or the README use an API the AI SDK marks `@deprecated`, and type-checks the README's `ts` snippets so they cannot rot. `tsc` ignores `@deprecated`, so this class of drift was previously invisible.
- `pnpm type-check:examples` — type-checks `examples/` and `scripts/`, which `tsconfig.json` (`include: ["src"]`) never covered.
- Tests that exercise the provider through the `ai` package (`generateText`, `streamText`, `Output.object`) instead of only at the `LanguageModelV4` boundary.

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
