// dsh-gemini-multimodal — DeepSeek Harness (Cordis) plugin.
//
// Multimodal tools for dsh: the harness model (e.g. DeepSeek) is text-only, so
// media understanding / transcription / document reading / image generation
// are delegated to Gemini. Two interchangeable providers:
//   - `gemini_api`      : direct Gemini REST, needs an API key
//                         (aistudio.google.com — AQ./AIza keys both work)
//   - `antigravity_cli` : local `agy` binary on PATH (Google account sign-in,
//                         no key needed)
//
// Tools:
//   media_understand(source, question?)   image/audio/video/URL → analysis
//   media_transcribe(source)              audio/video → verbatim text
//   image_generate(prompt)                text → PNG (saved locally)
//   read_document(path, question?)        PDF/office/text → summary/answer
//
// Privacy: credentials come from plugin config only, never logged.

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { runProvider, type MediaAction, type ProviderName } from './providers.js'

export const name = 'gemini-multimodal'
export const inject = ['tools', 'systemPrompt']

export interface Config {
  /** Backend: `gemini_api` (REST + key) or `antigravity_cli` (local agy). */
  provider: string
  /** Gemini API key — required only when provider is gemini_api. */
  api_key?: string
  /** Image generation model (default gemini-2.5-flash-image). */
  image_model?: string
  /** Where generated images land (default OS temp). */
  output_dir?: string
  /** agy headless: allow full tool access (default true). Set false to rely
   *  on permissions.allow rules in ~/.gemini/antigravity-cli/settings.json. */
  skip_permissions?: boolean
}

export const Config: z<Config> = z.object({
  provider: z.string().required().description('Backend: gemini_api (REST + key) or antigravity_cli (local agy)'),
  api_key: z.string().description('Gemini API key (aistudio.google.com). Required for gemini_api provider.'),
  image_model: z.string().description('Image generation model (default gemini-2.5-flash-image)'),
  output_dir: z.string().description('Directory for generated images (default OS temp)'),
  skip_permissions: z.boolean().description('agy headless: allow full tool access (default true)'),
})

function toolResultText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const OUTPUT = {
  schema: { type: 'json' },
  render: (_args: unknown, value: unknown) => [{ type: 'text', text: toolResultText(value) }],
}

export function apply(ctx: Context, config: Config): void {
  const provider = config.provider
  if (provider !== 'gemini_api' && provider !== 'antigravity_cli') {
    throw new Error(`gemini-multimodal: provider must be 'gemini_api' or 'antigravity_cli', got ${JSON.stringify(provider)}`)
  }

  ctx.systemPrompt.section({
    name: 'tool:gemini-multimodal',
    order: 116,
    text:
      'You can delegate perception to Gemini (multimodal): media_understand for ' +
      'images/audio/video/URLs, media_transcribe for verbatim audio/video text, ' +
      'image_generate to create images, read_document for PDF/office files. Use ' +
      'them when the task needs eyes or ears that the main model lacks.',
  })

  const run = (action: MediaAction, arg: { source?: string; question?: string; prompt?: string }, exec: { signal?: AbortSignal }) =>
    runProvider(
      {
        provider: config.provider as ProviderName,
        apiKey: config.api_key,
        imageModel: config.image_model,
        outputDir: config.output_dir,
        skipPermissions: config.skip_permissions,
        signal: exec.signal,
      },
      action,
      arg,
    )

  const register = (tool: Record<string, unknown>): void => {
    ctx.tools.register(defineTool(tool as never))
  }

  register({
    name: 'media_understand',
    description:
      'Understand an image, audio, video, or remote URL via Gemini. Returns a text analysis (content, OCR, charts, UI, spoken words). Accepts a local path or http(s) URL.',
    parameters: {
      source: { type: 'string', required: true, description: 'Local file path or http(s) URL of the media' },
      question: { type: 'string', description: 'Optional specific question to answer about the media' },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args: { source?: unknown; question?: unknown }, exec: { signal?: AbortSignal }) => run('understand', { source: String(args.source ?? ''), question: args.question ? String(args.question) : undefined }, exec),
  })

  register({
    name: 'media_transcribe',
    description:
      'Transcribe an audio or video file to verbatim text (with timestamps where useful) via Gemini. Accepts a local path or http(s) URL.',
    parameters: {
      source: { type: 'string', required: true, description: 'Local audio/video path or http(s) URL' },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args: { source?: unknown }, exec: { signal?: AbortSignal }) => run('transcribe', { source: String(args.source ?? '') }, exec),
  })

  register({
    name: 'image_generate',
    description:
      'Generate an image from a text prompt (Gemini Nano Banana). Saves a PNG locally and returns the file path. Note: free-tier image quota is very low (429s are common).',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Image description / prompt' },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args: { prompt?: unknown }, exec: { signal?: AbortSignal }) => run('image_generate', { prompt: String(args.prompt ?? '') }, exec),
  })

  register({
    name: 'read_document',
    description:
      'Read a PDF, Office, or text document via Gemini and summarize it or answer a question about it. Accepts a local path.',
    parameters: {
      source: { type: 'string', required: true, description: 'Local document path (pdf/docx/txt/md/csv/...) or URL' },
      question: { type: 'string', description: 'Optional specific question about the document' },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args: { source?: unknown; question?: unknown }, exec: { signal?: AbortSignal }) => run('read_document', { source: String(args.source ?? ''), question: args.question ? String(args.question) : undefined }, exec),
  })
}
