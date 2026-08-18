import { interfaze } from '@interfaze-ai/ai-sdk-provider';
import { generateText } from 'ai';

// Pass a public URL — Interfaze fetches it server-side — or raw bytes.

// PDF
const pdf = await generateText({
  model: interfaze('interfaze-beta'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Summarize this document in one sentence.' },
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: new URL('https://arxiv.org/pdf/1706.03762'),
        },
      ],
    },
  ],
});
console.log('PDF:', pdf.text);

// Image
const image = await generateText({
  model: interfaze('interfaze-beta'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What animal is in this image? One word.' },
        {
          type: 'image',
          image: new URL('https://picsum.photos/id/237/320/320'),
        },
      ],
    },
  ],
});
console.log('Image:', image.text);

// Video — a file part with a video/* media type; read server-side.
const video = await generateText({
  model: interfaze('interfaze-beta'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this video in one short sentence.' },
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
console.log('Video:', video.text);

// Audio — any of wav / mp3 / m4a / ogg / flac.
const audio = await generateText({
  model: interfaze('interfaze-beta'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Transcribe the first sentence.' },
        {
          type: 'file',
          mediaType: 'audio/mpeg',
          data: new URL(
            'https://r2public.jigsawstack.com/interfaze/examples/stt_call.mp3',
          ),
        },
      ],
    },
  ],
});
console.log('Audio:', audio.text);
