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
const VIDEO_SENTINEL_PREFIX =
  'ai-sdk/interfaze:video-file-part:5f9c1e3a-2b47-4d6c-8a01-7e3f9d2c4b60:';

interface InterfazeVideoFilePayload {
  file_data: string;
  filename?: string;
  format: string;
}

function encodeVideoSentinel(payload: InterfazeVideoFilePayload): string {
  return `${VIDEO_SENTINEL_PREFIX}${JSON.stringify(payload)}`;
}

function decodeVideoSentinel(
  text: unknown,
): InterfazeVideoFilePayload | undefined {
  if (typeof text !== 'string' || !text.startsWith(VIDEO_SENTINEL_PREFIX)) {
    return undefined;
  }
  try {
    return secureJsonParse(
      text.slice(VIDEO_SENTINEL_PREFIX.length),
    ) as InterfazeVideoFilePayload;
  } catch {
    return undefined;
  }
}

/**
 * Replaces `video/*` file parts in user messages with sentinel text parts so
 * they survive `convertToOpenAICompatibleChatMessages` without throwing.
 * Must be paired with {@link resolveInterfazeVideoFileParts}.
 */
export function injectInterfazeVideoSentinels(
  prompt: LanguageModelV4Prompt,
): LanguageModelV4Prompt {
  return prompt.map(message => {
    if (message.role !== 'user') {
      return message;
    }

    let changed = false;
    const content = message.content.map(part => {
      if (
        part.type !== 'file' ||
        getTopLevelMediaType(part.mediaType) !== 'video'
      ) {
        return part;
      }

      changed = true;

      let file_data: string;
      switch (part.data.type) {
        case 'url': {
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
            functionality: `video file parts with data type "${part.data.type}"`,
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
        text: encodeVideoSentinel({
          file_data,
          filename: part.filename,
          format,
        }),
      };
    });

    return changed ? { ...message, content } : message;
  });
}

function toInterfazeVideoFilePart(payload: InterfazeVideoFilePayload) {
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
 * Reverses {@link injectInterfazeVideoSentinels}: walks the converted request
 * body's `messages` and swaps sentinel text parts back to Interfaze's video
 * file-part shape. Intended for use as (part of) `transformRequestBody`.
 */
export function resolveInterfazeVideoFileParts(
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
    const directPayload = decodeVideoSentinel(message.content);
    if (directPayload) {
      return { ...message, content: [toInterfazeVideoFilePart(directPayload)] };
    }

    if (!Array.isArray(message.content)) {
      return message;
    }

    let changed = false;
    const content = message.content.map((part: any) => {
      if (part?.type !== 'text') {
        return part;
      }
      const payload = decodeVideoSentinel(part.text);
      if (!payload) {
        return part;
      }
      changed = true;
      return toInterfazeVideoFilePart(payload);
    });

    return changed ? { ...message, content } : message;
  });

  return { ...args, messages };
}
