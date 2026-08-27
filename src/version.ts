// Single source of truth for the version reported at runtime.
//
// This is a plain literal rather than a build-time define: JSR publishes the
// raw sources with no build step, so anything injected by tsup would be
// missing there and `VERSION` would fall back to a placeholder.
// `scripts/check-versions.mjs` keeps this in lockstep with package.json and
// jsr.json, and CI fails the build if they drift.
export const VERSION = '1.0.1';
