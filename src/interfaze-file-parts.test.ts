import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import {
  injectInterfazeFileSentinels,
  resolveInterfazeFileParts,
} from './interfaze-file-parts';

describe('injectInterfazeFileSentinels + resolveInterfazeFileParts', () => {
  it('round-trips a data: video part that is the only content in the message', () => {
    const prompt: LanguageModelV4Prompt = [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'video/mp4',
            filename: 'clip.mp4',
            data: { type: 'data', data: 'AQID' },
          },
        ],
      },
    ];

    const injected = injectInterfazeFileSentinels(prompt);

    const args = {
      messages: [
        { role: 'user', content: (injected[0] as any).content[0].text },
      ],
    };

    const resolved = resolveInterfazeFileParts(args);
    expect(resolved.messages[0].content).toEqual([
      {
        type: 'file',
        file: {
          file_data: 'data:video/mp4;base64,AQID',
          filename: 'clip.mp4',
          format: 'video/mp4',
        },
      },
    ]);
  });

  it('round-trips a url video part alongside a text part', () => {
    const prompt: LanguageModelV4Prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What happens in this clip?' },
          {
            type: 'file',
            mediaType: 'video/mp4',
            data: { type: 'url', url: new URL('https://example.com/clip.mp4') },
          },
        ],
      },
    ];

    const injected = injectInterfazeFileSentinels(prompt);
    const args = {
      messages: [
        {
          role: 'user',
          content: (injected[0] as any).content.map((part: any) =>
            part.type === 'text' ? { type: 'text', text: part.text } : part,
          ),
        },
      ],
    };

    const resolved = resolveInterfazeFileParts(args);
    expect(resolved.messages[0].content).toEqual([
      { type: 'text', text: 'What happens in this clip?' },
      {
        type: 'file',
        file: {
          file_data: 'https://example.com/clip.mp4',
          format: 'video/mp4',
        },
      },
    ]);
  });

  it('leaves non-video file parts and non-user messages untouched', () => {
    const prompt: LanguageModelV4Prompt = [
      { role: 'system', content: 'You are a helpful assistant.' },
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'data', data: 'AQID' },
          },
        ],
      },
    ];

    const injected = injectInterfazeFileSentinels(prompt);
    expect(injected).toEqual(prompt);
  });

  it('is a no-op for messages with no file parts', () => {
    const args = {
      messages: [{ role: 'user', content: 'just text' }],
    };
    expect(resolveInterfazeFileParts(args)).toEqual(args);
  });
});

describe('media types routed to the Interfaze file shape', () => {
  const asFilePart = (mediaType: string) => {
    const prompt: LanguageModelV4Prompt = [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType,
            data: { type: 'url', url: new URL('https://example.com/f') },
          },
        ],
      },
    ];
    const injected = injectInterfazeFileSentinels(prompt);
    const part = (injected[0] as any).content[0];
    return part.type === 'text' && part.text.startsWith('ai-sdk/interfaze:')
      ? 'sentinel'
      : 'native';
  };

  // Everything the openai-compatible converter would reject or mis-encode.
  it.each([
    'audio/wav',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/flac',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska',
    'application/pdf',
    'application/json',
    'application/xml',
    'application/yaml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ])('routes %s through the sentinel', mediaType => {
    expect(asFilePart(mediaType)).toBe('sentinel');
  });

  // Handled natively by the converter in a shape Interfaze already accepts.
  it.each(['image/png', 'image/jpeg', 'image/webp', 'text/csv', 'text/plain'])(
    'leaves %s on the native path',
    mediaType => {
      expect(asFilePart(mediaType)).toBe('native');
    },
  );
});
