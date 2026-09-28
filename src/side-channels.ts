import { secureJsonParse } from '@ai-sdk/provider-utils';

const TAG_RE = (tag: string) =>
  new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');

/**
 * Pull `<think>`/`<precontext>` blocks out of a complete (non-streamed)
 * string; returns the remaining visible text plus any extracted reasoning /
 * precontext. Interfaze's non-streaming responses already separate these
 * into top-level `reasoning`/`precontext` fields, so this is a defensive
 * no-op in the common case — it only does work if tags leak into `content`.
 */
export function stripSideChannels(content: string): {
  text: string;
  reasoning?: string;
  precontext?: unknown[];
} {
  let text = content;

  const thinks: string[] = [];
  text = text.replace(TAG_RE('think'), (_m, inner: string) => {
    thinks.push(inner.trim());
    return '';
  });

  const pre: unknown[] = [];
  text = text.replace(TAG_RE('precontext'), (_m, inner: string) => {
    try {
      const parsed = secureJsonParse(inner.trim());
      if (Array.isArray(parsed)) {
        pre.push(...parsed);
      } else {
        pre.push(parsed);
      }
    } catch {
      // ignore malformed block
    }
    return '';
  });

  const out: { text: string; reasoning?: string; precontext?: unknown[] } = {
    text: text.trim(),
  };
  if (thinks.length > 0) {
    out.reasoning = thinks.join('\n');
  }
  if (pre.length > 0) {
    out.precontext = pre;
  }
  return out;
}

/**
 * Removes only *closed* `<think>`/`<precontext>` blocks without trimming, so
 * the result can be prefix-compared against already-emitted stream text.
 */
export function withoutClosedBlocks(content: string): string {
  return content.replace(TAG_RE('think'), '').replace(TAG_RE('precontext'), '');
}

/** Interfaze returns `json_object` content wrapped in a ```json fence; unwrap it. */
export function stripJsonFence(content: string): string {
  const t = content.trim();
  if (!t.startsWith('```')) {
    return content;
  }
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

const SIDE_OPEN = ['<think>', '<precontext>'] as const;
const SIDE_CLOSE: Record<string, string> = {
  '<think>': '</think>',
  '<precontext>': '</precontext>',
};

function trailingPartialTagLength(text: string, tag: string): number {
  for (let len = Math.min(text.length, tag.length - 1); len > 0; len--) {
    if (text.slice(text.length - len) === tag.slice(0, len)) {
      return len;
    }
  }
  return 0;
}

/**
 * Strips inline `<think>`/`<precontext>` blocks from streamed content, chunk
 * by chunk, holding back any text that might be the start of a tag until
 * enough of the stream has arrived to decide.
 */
export class SideChannelFilter {
  #buffer = '';
  #closingTag: string | undefined;

  feed(text: string): string {
    this.#buffer += text;
    const visible: string[] = [];

    while (this.#buffer) {
      if (this.#closingTag === undefined) {
        const tagStart = this.#buffer.indexOf('<');
        if (tagStart === -1) {
          visible.push(this.#buffer);
          this.#buffer = '';
          break;
        }
        if (tagStart > 0) {
          visible.push(this.#buffer.slice(0, tagStart));
          this.#buffer = this.#buffer.slice(tagStart);
        }

        const openingTag = SIDE_OPEN.find(tag => this.#buffer.startsWith(tag));
        if (openingTag) {
          this.#closingTag = SIDE_CLOSE[openingTag];
          this.#buffer = this.#buffer.slice(openingTag.length);
          continue;
        }

        if (SIDE_OPEN.some(tag => tag.startsWith(this.#buffer))) {
          break;
        }

        visible.push('<');
        this.#buffer = this.#buffer.slice(1);
      } else {
        const closeIndex = this.#buffer.indexOf(this.#closingTag);
        if (closeIndex === -1) {
          const partialLen = trailingPartialTagLength(
            this.#buffer,
            this.#closingTag,
          );
          this.#buffer = partialLen
            ? this.#buffer.slice(this.#buffer.length - partialLen)
            : '';
          break;
        }
        this.#buffer = this.#buffer.slice(closeIndex + this.#closingTag.length);
        this.#closingTag = undefined;
      }
    }

    return visible.join('');
  }

  flush(): string {
    if (this.#closingTag !== undefined) {
      this.#buffer = '';
      return '';
    }
    const remaining = this.#buffer;
    this.#buffer = '';
    return remaining;
  }
}
