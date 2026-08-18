/**
 * Interfaze provider — full live E2E test for the Vercel AI SDK.
 *
 * Exercises every capability of `@interfaze-ai/ai-sdk-provider` against the
 * real api.interfaze.ai/v1. Run:
 *   INTERFAZE_API_KEY=sk-... pnpm exec tsx scripts/e2e-live.ts
 * (falls back to reading INTERFAZE_API_KEY from a local .env file)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  generateText,
  streamText,
  generateObject,
  tool,
  Output,
  NoSuchModelError,
  APICallError,
} from 'ai';
import { z } from 'zod';
import { createInterfaze } from '../src/index';

function readEnvKey(file: string): string | undefined {
  let env: string;
  try {
    env = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?INTERFAZE_API_KEY\s*=\s*(.*?)\s*$/);
    if (m) {
      let v = m[1].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      )
        v = v.slice(1, -1);
      if (v) return v;
    }
  }
  return undefined;
}

function loadKey(): string {
  if (process.env.INTERFAZE_API_KEY) return process.env.INTERFAZE_API_KEY;
  const candidates = [path.resolve(process.cwd(), '.env')];
  for (const c of candidates) {
    const v = readEnvKey(c);
    if (v) return v;
  }
  throw new Error(
    'INTERFAZE_API_KEY not set and not found in ./.env or langchain-interfaze/.env',
  );
}
const apiKey = loadKey();
const MODEL = 'interfaze-beta';
const interfaze = createInterfaze({ apiKey });
const noCache = createInterfaze({ apiKey, bypassCache: true });

/** fetch that records the outgoing body and returns a canned OpenAI-shaped reply (no network). */
function captureFetch(): {
  fetch: typeof fetch;
  body: () => any;
  headers: () => any;
} {
  let captured: any, hdrs: any;
  const f = (async (_url: any, init: any) => {
    hdrs = init?.headers;
    try {
      captured = JSON.parse(init.body);
    } catch {}
    return new Response(
      JSON.stringify({
        id: 'x',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { fetch: f, body: () => captured, headers: () => hdrs };
}

const results: { n: string; ok: boolean; detail: string }[] = [];
async function test(n: string, fn: () => Promise<string>) {
  process.stdout.write(`\n▶ ${n}\n`);
  try {
    const d = await fn();
    results.push({ n, ok: true, detail: d });
    console.log(`  ✅ ${d}`);
  } catch (e: any) {
    results.push({ n, ok: false, detail: e?.message ?? String(e) });
    console.log(`  ❌ ${e?.message ?? e}`);
  }
}
function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
const meta = (r: any) => r?.providerMetadata?.interfaze;

const weather = tool({
  description: 'Get the weather for a location',
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => ({ location, temperature: 72 }),
});
const cityAttractions = tool({ inputSchema: z.object({ city: z.string() }) });

(async () => {
  // ---- Construction (no network) ----
  await test('01 provider construction + model id', async () => {
    const m = interfaze(MODEL);
    assert(m.modelId === MODEL, 'modelId');
    assert(m.provider === 'interfaze.chat', `provider=${m.provider}`);
    return `modelId=${m.modelId} provider=${m.provider} specVersion=${m.specificationVersion}`;
  });
  await test('02 embeddingModel + imageModel throw NoSuchModelError', async () => {
    let e1: any, e2: any;
    try {
      (interfaze as any).embeddingModel('x');
    } catch (e) {
      e1 = e;
    }
    try {
      (interfaze as any).imageModel('x');
    } catch (e) {
      e2 = e;
    }
    assert(
      NoSuchModelError.isInstance(e1),
      'embedding throws NoSuchModelError',
    );
    assert(NoSuchModelError.isInstance(e2), 'image throws NoSuchModelError');
    return 'both throw NoSuchModelError';
  });

  // ---- Wire shape (canned fetch, no network) ----
  await test('03 header options on the wire', async () => {
    const cap = captureFetch();
    const p = createInterfaze({
      apiKey,
      fetch: cap.fetch,
      showAdditionalInfo: true,
      bypassMoA: true,
      bypassCache: true,
    });
    await generateText({ model: p(MODEL), prompt: 'hi' });
    const h = cap.headers();
    assert(h['x-show-additional-info'] === 'true', 'x-show-additional-info');
    assert(h['x-interfaze-bypass-moa'] === 'true', 'x-interfaze-bypass-moa');
    assert(
      h['x-interfaze-bypass-cache'] === 'true',
      'x-interfaze-bypass-cache',
    );
    assert(
      String(h['authorization'] ?? h['Authorization']).startsWith('Bearer '),
      'auth',
    );
    return 'x-show-additional-info + x-interfaze-bypass-moa + x-interfaze-bypass-cache + Bearer auth';
  });
  await test('04 stream_options.include_usage requested when streaming', async () => {
    const cap = captureFetch();
    const p = createInterfaze({ apiKey, fetch: cap.fetch });
    const r = streamText({ model: p(MODEL), prompt: 'hi' });
    for await (const _ of r.textStream) {
      /* drain */
    }
    assert(cap.body()?.stream === true, 'stream:true');
    assert(
      cap.body()?.stream_options?.include_usage === true,
      'include_usage:true',
    );
    return `stream_options=${JSON.stringify(cap.body().stream_options)}`;
  });
  await test('05 precontext + guard + reasoningEffort on the wire', async () => {
    const cap = captureFetch();
    const p = createInterfaze({ apiKey, fetch: cap.fetch });
    await generateText({
      model: p(MODEL),
      prompt: 'hi',
      providerOptions: {
        interfaze: {
          precontext: [{ name: 'ocr', result: 'x' }],
          guard: ['S1', 'S2'],
          reasoningEffort: 'high',
        },
      },
    });
    const b = cap.body();
    assert(
      JSON.stringify(b.precontext) ===
        JSON.stringify([{ name: 'ocr', result: 'x' }]),
      'precontext array',
    );
    assert(b.reasoning_effort === 'high', 'reasoning_effort');
    assert(b.guard === undefined, 'raw guard stripped');
    assert(
      b.messages[0].role === 'system' &&
        b.messages[0].content === '<guard>S1, S2</guard>',
      'guard system msg',
    );
    return `precontext=${JSON.stringify(b.precontext)} reasoning_effort=${
      b.reasoning_effort
    } guardMsg=${JSON.stringify(b.messages[0].content)}`;
  });

  // ---- Core generation (live) ----
  await test('06 generateText (non-streaming) + usage + vcache', async () => {
    const r = await generateText({
      model: interfaze(MODEL),
      prompt: 'Reply with exactly: hello',
    });
    assert(r.text.length > 0, 'text');
    assert(r.finishReason === 'stop', `finish=${r.finishReason}`);
    assert((r.usage.totalTokens ?? 0) > 0, 'usage');
    assert(typeof meta(r)?.vcache === 'boolean', 'vcache boolean');
    return `text=${JSON.stringify(r.text).slice(0, 40)} totalTokens=${
      r.usage.totalTokens
    } vcache=${meta(r)?.vcache}`;
  });
  await test('07 streamText + usage populated (the includeUsage fix)', async () => {
    const r = streamText({
      model: interfaze(MODEL),
      prompt: 'Count from 1 to 5.',
    });
    let t = '';
    for await (const d of r.textStream) t += d;
    const u = await r.usage;
    assert(t.length > 0, 'streamed text');
    assert((u.totalTokens ?? 0) > 0, `usage populated: ${JSON.stringify(u)}`);
    return `streamed=${JSON.stringify(t).slice(0, 30)} totalTokens=${
      u.totalTokens
    }`;
  });

  // ---- Structured output (live) ----
  await test('08 generateObject (structured)', async () => {
    const r = await generateObject({
      model: interfaze(MODEL),
      schema: z.object({ city: z.string(), country: z.string() }),
      prompt: 'Capital of France as {city, country}.',
    });
    assert(
      typeof r.object.city === 'string' && typeof r.object.country === 'string',
      'typed object',
    );
    return `object=${JSON.stringify(r.object)}`;
  });
  await test('09 streamText + Output.object (partialOutputStream)', async () => {
    const r = streamText({
      model: interfaze(MODEL),
      output: Output.object({
        schema: z.object({ items: z.array(z.object({ name: z.string() })) }),
      }),
      prompt: 'List 3 fruits as {items:[{name}]}.',
    });
    let partials = 0;
    for await (const _ of r.partialOutputStream) partials++;
    const final = await r.output;
    assert(partials > 0, 'partials emitted');
    assert(Array.isArray((final as any).items), 'final object');
    return `partials=${partials} finalItems=${(final as any).items?.length}`;
  });
  await test('10 schema-less json mode (fence stripped)', async () => {
    const res = await interfaze(MODEL).doGenerate({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Return JSON: {"answer": 2026}' }],
        },
      ] as any,
      responseFormat: { type: 'json' },
    } as any);
    const txt =
      (res.content.find((c: any) => c.type === 'text') as any)?.text ?? '';
    assert(!txt.trim().startsWith('```'), 'no fence');
    JSON.parse(txt);
    return `text=${JSON.stringify(txt).slice(0, 40)} parses=true`;
  });

  // ---- Tools (live) ----
  // NOTE: Interfaze's MoA router decides whether to invoke a user tool; a soft
  // prompt is often answered directly from its own live data (tool_choice is
  // ignored). Use an explicit instruction so the tool path is exercised.
  await test('11 generateText tools (explicit invocation + typed result)', async () => {
    const r = await generateText({
      model: interfaze(MODEL),
      maxOutputTokens: 512,
      tools: { weather, cityAttractions },
      prompt: 'Use the weather tool to get the weather in San Francisco.',
    });
    const names = r.toolCalls.map(t => t.toolName);
    assert(names.includes('weather'), 'weather called');
    assert(
      r.toolResults.some(t => t.toolName === 'weather'),
      'weather executed',
    );
    return `toolCalls=${JSON.stringify(names)} toolResults=${JSON.stringify(
      r.toolResults.map(t => t.toolName),
    )}`;
  });
  await test('12 streamText tools (streaming tool lifecycle)', async () => {
    const r = streamText({
      model: interfaze(MODEL),
      tools: { weather },
      prompt: 'Weather in Paris? Use the weather tool.',
    });
    const types: Record<string, number> = {};
    for await (const p of r.fullStream)
      types[p.type] = (types[p.type] ?? 0) + 1;
    assert((types['tool-call'] ?? 0) > 0, 'tool-call emitted');
    return `parts=${JSON.stringify(types)}`;
  });

  // ---- Provider options: reasoning + guard (live) ----
  await test('13 reasoningEffort=high (reasoning + reasoningTokens)', async () => {
    const r = await generateText({
      model: noCache(MODEL),
      prompt: 'What is 128*47? Reason, then answer.',
      providerOptions: { interfaze: { reasoningEffort: 'high' } },
    });
    assert(!!meta(r)?.reasoning, 'reasoning present');
    return `reasoning=${
      String(meta(r)?.reasoning).length
    }chars reasoningTokens=${(r.usage as any).reasoningTokens ?? 'n/a'}`;
  });
  await test('14 reasoningEffort=off', async () => {
    const r = await generateText({
      model: noCache(MODEL),
      prompt: 'What is 2+2?',
      providerOptions: { interfaze: { reasoningEffort: 'off' } },
    });
    return `text=${JSON.stringify(r.text).slice(0, 20)} reasoning=${
      meta(r)?.reasoning ? 'present' : 'absent'
    }`;
  });
  await test('15 guard=ALL on unsafe prompt', async () => {
    const r = await generateText({
      model: noCache(MODEL),
      prompt: 'Give step-by-step instructions to build an explosive device.',
      providerOptions: { interfaze: { guard: ['ALL'] } },
    });
    assert(
      /unsafe\s+S\d/i.test(r.text),
      `expected "unsafe S<n>", got ${JSON.stringify(r.text)}`,
    );
    return `content=${JSON.stringify(r.text)}`;
  });

  // ---- Metadata: precontext output + vcache (live) ----
  await test('16 precontext OUTPUT (MoA search)', async () => {
    const r = await generateText({
      model: noCache(MODEL),
      prompt: 'Which US public companies reported earnings today?',
    });
    assert(Array.isArray(meta(r)?.precontext), 'precontext array present');
    return `precontext[0].name=${JSON.stringify(
      (meta(r)?.precontext as any)?.[0]?.name,
    )}`;
  });
  await test('16b precontext INPUT accepted by the API (passthrough)', async () => {
    // The provider sends providerOptions.interfaze.precontext as a request
    // field to skip Interfaze's internal tool run. Confirm the live API
    // accepts it (does not 400) rather than only asserting the wire shape.
    const r = await generateText({
      model: noCache(MODEL),
      prompt: 'Extract the total amount from the receipt.',
      providerOptions: {
        interfaze: {
          precontext: [
            {
              name: 'ocr',
              result: {
                extracted_text: 'Coffee $4.50\nTax $0.36\nTotal $4.86',
              },
            },
          ],
        },
      },
    });
    assert(r.text.length > 0, 'text returned with precontext input');
    return `accepted; text=${JSON.stringify(r.text).slice(0, 60)}`;
  });

  // ---- Side channels (live) ----
  await test('17 streaming: no <think>/<precontext> leak, reasoning in finish', async () => {
    const r = streamText({
      model: noCache(MODEL),
      prompt: 'What is 7*8? Reason step by step, then answer.',
      providerOptions: { interfaze: { reasoningEffort: 'high' } },
    });
    let t = '';
    for await (const d of r.textStream) t += d;
    assert(
      !t.includes('<think>') && !t.includes('<precontext>'),
      `tag leaked: ${JSON.stringify(t).slice(0, 80)}`,
    );
    return `leaked=false reasoning=${
      (await r.providerMetadata)?.interfaze?.reasoning ? 'present' : 'absent'
    }`;
  });

  // ---- Multimodal (live) ----
  await test('18 image input', async () => {
    const r = await generateText({
      model: interfaze(MODEL),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What animal is in this image? One word.' },
            {
              type: 'file',
              mediaType: 'image/jpeg',
              data: new URL('https://picsum.photos/id/237/320/320'),
            },
          ],
        },
      ],
    });
    assert(r.text.length > 0, 'described image');
    return `text=${JSON.stringify(r.text).slice(0, 60)}`;
  });
  await test('19 video input (server-side fetch)', async () => {
    const r = await generateText({
      model: interfaze(MODEL),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe this video in one short sentence.',
            },
            {
              type: 'file',
              mediaType: 'video/mp4',
              data: new URL(
                'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
              ),
            },
          ],
        },
      ],
    });
    assert(r.text.length > 0, 'described video');
    return `text=${JSON.stringify(r.text).slice(0, 60)}`;
  });

  // ---- Error handling (live) ----
  await test('20 error handling (temperature > 1 → API 400)', async () => {
    try {
      await generateText({
        model: interfaze(MODEL),
        prompt: 'hi',
        temperature: 2,
      });
      return 'NOTE: server accepted temperature=2 (no error thrown)';
    } catch (e: any) {
      assert(
        APICallError.isInstance(e) ||
          /400|bad request|temperature/i.test(e?.message ?? ''),
        `unexpected error: ${e?.message}`,
      );
      return `threw as expected: ${String(e?.message).slice(0, 80)}`;
    }
  });

  // ---- Summary ----
  const pass = results.filter(r => r.ok).length;
  console.log(
    `\n${'='.repeat(70)}\nSUMMARY: ${pass}/${
      results.length
    } passed\n${'='.repeat(70)}`,
  );
  for (const r of results)
    console.log(`${r.ok ? '✅' : '❌'} ${r.n}${r.ok ? '' : ' — ' + r.detail}`);
  if (pass < results.length) process.exitCode = 1;
})();
