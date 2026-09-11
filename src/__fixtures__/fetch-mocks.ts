import type { FetchFunction } from '@ai-sdk/provider-utils';
import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import { createInterfaze } from '../interfaze-provider';

/**
 * Shared fetch mocks for the test suites.
 *
 * Each mock builds a fresh `Response` per call rather than resolving the same
 * one repeatedly: a `Response` body can only be read once, so a retried
 * request (the AI SDK retries twice by default) would otherwise fail with
 * "Body is unusable" and mask whatever provoked the retry.
 */

const fixture = (file: string) =>
  fs.readFileSync(path.join(import.meta.dirname, file), 'utf8');

export function createJsonFixtureFetchMock(filename: string) {
  const body = fixture(`${filename}.json`);

  return vi.fn(
    async () =>
      new Response(body, { headers: { 'content-type': 'application/json' } }),
  );
}

export function createStreamFixtureFetchMock(filename: string) {
  const body = [
    ...fixture(`${filename}.chunks.txt`)
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(chunk => `data: ${chunk}\n\n`),
    'data: [DONE]\n\n',
  ].join('');

  return vi.fn(
    async () =>
      new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  );
}

/**
 * A fetch mock that records every outgoing request body, for asserting on what
 * actually reaches the wire.
 */
export function createCapturingFetchMock(filename: string) {
  const body = fixture(`${filename}.json`);
  const requests: Record<string, unknown>[] = [];

  const fetch = vi.fn(async (_input: unknown, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    return new Response(body, {
      headers: { 'content-type': 'application/json' },
    });
  });

  return { fetch: fetch as unknown as FetchFunction, requests };
}

export const modelWith = (fetch: FetchFunction) =>
  createInterfaze({ apiKey: 'test-api-key', fetch })('interfaze');
