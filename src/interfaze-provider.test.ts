import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInterfaze } from './interfaze-provider';
import { loadApiKey } from '@ai-sdk/provider-utils';
import { InterfazeChatLanguageModel } from './interfaze-chat-language-model';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

vi.mock('@ai-sdk/provider-utils', async () => {
  const actual = await vi.importActual('@ai-sdk/provider-utils');
  return {
    ...actual,
    loadApiKey: vi.fn().mockReturnValue('mock-api-key'),
  };
});

describe('InterfazeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createInterfaze', () => {
    it('should create an InterfazeProvider instance with default options', () => {
      const provider = createInterfaze();
      const model = provider('interfaze') as any;
      model.config.headers(); // apiKey is only resolved lazily, on request

      expect(loadApiKey).toHaveBeenCalledWith({
        apiKey: undefined,
        environmentVariableName: 'INTERFAZE_API_KEY',
        description: 'Interfaze API key',
      });
    });

    it('should create an InterfazeProvider instance with custom options', () => {
      const options = {
        apiKey: 'custom-key',
        baseURL: 'https://custom.url',
        headers: { 'Custom-Header': 'value' },
      };
      const provider = createInterfaze(options);
      const model = provider('interfaze') as any;
      model.config.headers();

      expect(loadApiKey).toHaveBeenCalledWith({
        apiKey: 'custom-key',
        environmentVariableName: 'INTERFAZE_API_KEY',
        description: 'Interfaze API key',
      });
    });

    it('appends a versioned user-agent token on the real request path', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'x',
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: { role: 'assistant', content: 'ok' },
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      );

      const provider = createInterfaze({ apiKey: 'k', fetch: fetchMock });
      await provider('interfaze').doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      });

      const [, init] = fetchMock.mock.calls[0] as unknown as [
        unknown,
        { headers: Record<string, string> },
      ];
      const headers = init.headers;
      expect(headers['user-agent']).toContain(
        '@interfaze-ai/ai-sdk/0.0.0-test',
      );
      // The core SDK's own token must survive the append, not be replaced.
      expect(headers['user-agent']).toContain('ai-sdk/provider-utils/');
    });

    it('maps client options to Interfaze headers', () => {
      const provider = createInterfaze({
        fetch: vi.fn(),
        showAdditionalInfo: true,
        bypassMoA: true,
        bypassCache: true,
      });
      const headers = (provider('interfaze') as any).config.headers();
      expect(headers['x-show-additional-info']).toBe('true');
      expect(headers['x-interfaze-bypass-moa']).toBe('true');
      expect(headers['x-interfaze-bypass-cache']).toBe('true');
    });

    it('omits client-option headers when unset', () => {
      const headers = (
        createInterfaze({ fetch: vi.fn() })('interfaze') as any
      ).config.headers();
      expect(headers['x-interfaze-bypass-moa']).toBeUndefined();
    });

    it('should default the base URL to the Interfaze API', () => {
      const provider = createInterfaze({ fetch: vi.fn() });
      const model = provider('interfaze') as InstanceType<
        typeof InterfazeChatLanguageModel
      >;
      expect((model as any).config.url({ path: '/chat/completions' })).toBe(
        'https://api.interfaze.ai/v1/chat/completions',
      );
    });

    it('should allow overriding the base URL', () => {
      const provider = createInterfaze({
        baseURL: 'https://staging.interfaze.ai/v1/',
        fetch: vi.fn(),
      });
      const model = provider('interfaze') as InstanceType<
        typeof InterfazeChatLanguageModel
      >;
      expect((model as any).config.url({ path: '/chat/completions' })).toBe(
        'https://staging.interfaze.ai/v1/chat/completions',
      );
    });

    it('should return an InterfazeChatLanguageModel when called as a function', () => {
      const provider = createInterfaze();
      expect(provider('interfaze')).toBeInstanceOf(InterfazeChatLanguageModel);
    });

    it('serializes guard codes into a <guard> system message', () => {
      const model = createInterfaze()('interfaze') as any;
      const out = model.config.transformRequestBody({
        model: 'interfaze',
        messages: [{ role: 'user', content: 'hi' }],
        guard: ['S1', 'S12_IMAGE'],
      });
      expect(out.guard).toBeUndefined();
      expect(out.messages[0]).toEqual({
        role: 'system',
        content: '<guard>S1, S12_IMAGE</guard>',
      });
      expect(out.messages[1]).toEqual({ role: 'user', content: 'hi' });
    });

    it('merges the guard tag into an existing string system message', () => {
      const model = createInterfaze()('interfaze') as any;
      const out = model.config.transformRequestBody({
        model: 'interfaze',
        messages: [
          { role: 'system', content: 'You are concise.' },
          { role: 'user', content: 'hi' },
        ],
        guard: ['S1'],
      });
      expect(out.messages[0].content).toBe(
        '<guard>S1</guard>\nYou are concise.',
      );
      expect(out.messages).toHaveLength(2);
    });
  });

  describe('languageModel', () => {
    it('should construct a language model with correct configuration', () => {
      const provider = createInterfaze();
      expect(provider.languageModel('interfaze')).toBeInstanceOf(
        InterfazeChatLanguageModel,
      );
    });
  });

  describe('chat', () => {
    it('should construct a chat model with correct configuration', () => {
      const provider = createInterfaze();
      expect(provider.chat('interfaze')).toBeInstanceOf(
        InterfazeChatLanguageModel,
      );
    });
  });

  describe('embeddingModel', () => {
    it('should throw NoSuchModelError when attempting to create embedding model', () => {
      const provider = createInterfaze();
      expect(() => provider.embeddingModel('any-model')).toThrow(
        'No such embeddingModel: any-model',
      );
    });
  });

  describe('imageModel', () => {
    it('should throw NoSuchModelError when attempting to create an image model', () => {
      const provider = createInterfaze();
      expect(() => provider.imageModel('any-model')).toThrow(
        'No such imageModel: any-model',
      );
    });
  });
});
