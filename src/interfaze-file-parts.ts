import {
  UnsupportedFunctionalityError,
  type LanguageModelV4Prompt,
} from '@ai-sdk/provider';
import {
  convertToBase64,
  getTopLevelMediaType,
  isFullMediaType,
  resolveFullMediaType,
  secureJsonParse,
} from '@ai-sdk/provider-utils';

// Plain-ASCII marker with a UUID — never NUL bytes, which make git treat the
// file as binary.
const FILE_SENTINEL_PREFIX =
  'ai-sdk/interfaze:file-part:5f9c1e3a-2b47-4d6c-8a01-7e3f9d2c4b60:';

/**
 * Media types `convertToOpenAICompatibleChatMessages` already expresses in a
 * shape Interfaze accepts, so they're left on the native path:
 *
 * - `image/*` → `image_url`, which takes a URL or a data URL directly.
 * - `text/*`  → inlined as a text part, which needs no attachment handling.
 *
 * Everything else is routed through {@link toInterfazeFilePart}. The converter
 * would otherwise throw on it — audio and PDF URLs are rejected outright, and
 * of the audio types Interfaze supports it only encodes wav and mp3.
 */
function needsInterfazeFilePart(mediaType: string): boolean {
  const topLevel = getTopLevelMediaType(mediaType);
  return topLevel !== 'image' && topLevel !== 'text';
}

interface InterfazeFilePayload {
  file_data: string;
  filename?: string;
  format: string;
}

function encodeFileSentinel(payload: InterfazeFilePayload): string {
  return `${FILE_SENTINEL_PREFIX}${JSON.stringify(payload)}`;
}

function decodeFileSentinel(text: unknown): InterfazeFilePayload | undefined {
  if (typeof text !== 'string' || !text.startsWith(FILE_SENTINEL_PREFIX)) {
    return undefined;
  }
  try {
    return secureJsonParse(
      text.slice(FILE_SENTINEL_PREFIX.length),
    ) as InterfazeFilePayload;
  } catch {
    return undefined;
  }
}

/**
 * Replaces audio / video / document file parts in user messages with sentinel
 * text parts so they survive `convertToOpenAICompatibleChatMessages` without
 * throwing. Must be paired with {@link resolveInterfazeFileParts}.
 */
export function injectInterfazeFileSentinels(
  prompt: LanguageModelV4Prompt,
): LanguageModelV4Prompt {
  return prompt.map(message => {
    if (message.role !== 'user') {
      return message;
    }

    let changed = false;
    const content = message.content.map(part => {
      if (part.type !== 'file' || !needsInterfazeFilePart(part.mediaType)) {
        return part;
      }

      changed = true;

      let file_data: string;
      switch (part.data.type) {
        case 'url': {
          // Interfaze fetches the URL server-side, so it's forwarded as-is.
          file_data = part.data.url.toString();
          break;
        }
        case 'data': {
          file_data = `data:${resolveFullMediaType({
            part,
          })};base64,${convertToBase64(part.data.data)}`;
          break;
        }
        default: {
          throw new UnsupportedFunctionalityError({
            functionality: `file parts with data type "${part.data.type}"`,
          });
        }
      }

      const format = isFullMediaType(part.mediaType)
        ? part.mediaType
        : part.data.type === 'data'
          ? resolveFullMediaType({ part })
          : part.mediaType;

      return {
        type: 'text' as const,
        text: encodeFileSentinel({
          file_data,
          filename: part.filename,
          format,
        }),
      };
    });

    return changed ? { ...message, content } : message;
  });
}

function toInterfazeFilePart(payload: InterfazeFilePayload) {
  return {
    type: 'file',
    file: {
      file_data: payload.file_data,
      ...(payload.filename ? { filename: payload.filename } : {}),
      format: payload.format,
    },
  };
}

/**
 * Reverses {@link injectInterfazeFileSentinels}: walks the converted request
 * body's `messages` and swaps sentinel text parts back to Interfaze's file-part
 * shape. Intended for use as (part of) `transformRequestBody`.
 */
export function resolveInterfazeFileParts(
  args: Record<string, any>,
): Record<string, any> {
  if (!Array.isArray(args.messages)) {
    return args;
  }

  const messages = args.messages.map((message: any) => {
    if (message == null || typeof message !== 'object') {
      return message;
    }

    // user messages with a single text part collapse `content` to a string
    const directPayload = decodeFileSentinel(message.content);
    if (directPayload) {
      return { ...message, content: [toInterfazeFilePart(directPayload)] };
    }

    if (!Array.isArray(message.content)) {
      return message;
    }

    let changed = false;
    const content = message.content.map((part: any) => {
      if (part?.type !== 'text') {
        return part;
      }
      const payload = decodeFileSentinel(part.text);
      if (!payload) {
        return part;
      }
      changed = true;
      return toInterfazeFilePart(payload);
    });

    return changed ? { ...message, content } : message;
  });

  return { ...args, messages };
}
