// dsh-gemini-multimodal — providers.
//
// Two interchangeable backends:
//   gemini_api        — direct Gemini REST (generateContent) with an API key
//                       from aistudio.google.com (AQ. / AIza keys both work).
//   antigravity_cli   — local Antigravity CLI (`agy` on PATH), no key needed
//                       once signed in. Headless mode requires permission
//                       bypass for tool access (see skipPermissions).
//
// Privacy: credentials come from plugin config only; nothing is logged.

import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'

export type ProviderName = 'gemini_api' | 'antigravity_cli'

export interface ProviderOptions {
  /** Backend. Optional — defaults to antigravity_cli (zero-config). */
  provider?: ProviderName
  /** API key — required only for `gemini_api`. */
  apiKey?: string
  /** Image generation model (default gemini-2.5-flash-image / Nano Banana). */
  imageModel?: string
  /** Directory for generated images (default OS temp). */
  outputDir?: string
  /** agy headless: pass --dangerously-skip-permissions (default true). */
  skipPermissions?: boolean
  /** Cooperative cancellation from the tool executor. */
  signal?: AbortSignal
}

export interface ProviderResult {
  ok: boolean
  /** Human-readable output (description / transcript / analysis). */
  text?: string
  /** Local path when a file artifact (image) was produced. */
  imagePath?: string
  error?: string
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MODEL = 'gemini-3-flash-preview'
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'
const MAX_INLINE_BYTES = 19 * 1024 * 1024 // Gemini inline_data limit ~20MB
const REQUEST_TIMEOUT_MS = 120_000

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
}

export function guessMimeType(pathOrUrl: string): string {
  const clean = pathOrUrl.split('?')[0]
  const ext = extname(clean).slice(1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function isRemote(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

/** Fetch a remote file into memory; local paths are read from disk. */
async function loadBytes(source: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (isRemote(source)) {
    const res = await fetch(source, { signal })
    if (!res.ok) throw new Error(`failed to download ${source}: HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  const data = readFileSync(source)
  if (data.byteLength > MAX_INLINE_BYTES) {
    throw new Error(`file too large for inline upload (${data.byteLength} bytes > ${MAX_INLINE_BYTES})`)
  }
  return data
}

// ---------------------------------------------------------------------------
// gemini_api — direct REST
// ---------------------------------------------------------------------------

/** Low-level Gemini generateContent call. Exported for tests/tools. */
export async function geminiGenerate(
  apiKey: string,
  model: string,
  parts: unknown[],
  signal?: AbortSignal,
): Promise<{ text?: string; inlineImage?: Uint8Array }> {
  const url = `${GEMINI_BASE}/models/${model}:generateContent`
  const body: Record<string, unknown> = { contents: [{ parts }] }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    const msg = detail.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ?? detail
    const hint =
      res.status === 429
        ? ' (quota exceeded — image generation free tier is very low; retry later or enable billing at aistudio.google.com)'
        : res.status === 400
          ? ' (bad request — unsupported media type or model?)'
          : ''
    throw new Error(`Gemini HTTP ${res.status}: ${msg}${hint}`)
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> } }>
  }
  const parts0 = data.candidates?.[0]?.content?.parts ?? []
  const text = parts0.map((p) => p.text ?? '').join('')
  const inline = parts0.find((p) => p.inlineData?.data)
  return { text, inlineImage: inline?.inlineData?.data ? Uint8Array.from(Buffer.from(inline.inlineData.data, 'base64')) : undefined }
}

async function geminiUnderstand(
  opts: ProviderOptions,
  source: string,
  question: string,
): Promise<ProviderResult> {
  try {
    const bytes = await loadBytes(source, opts.signal)
    const b64 = Buffer.from(bytes).toString('base64')
    const parts = [
      { inlineData: { mimeType: guessMimeType(source), data: b64 } },
      { text: question || 'Describe this media in detail (content, text, and any key facts).' },
    ]
    const { text } = await geminiGenerate(opts.apiKey!, DEFAULT_MODEL, parts, opts.signal)
    return { ok: true, text: text ?? '(empty response)' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function geminiTranscribe(opts: ProviderOptions, source: string): Promise<ProviderResult> {
  try {
    const bytes = await loadBytes(source, opts.signal)
    const b64 = Buffer.from(bytes).toString('base64')
    const parts = [
      { inlineData: { mimeType: guessMimeType(source), data: b64 } },
      { text: 'Transcribe this audio/video to text verbatim, with timestamps where useful.' },
    ]
    const { text } = await geminiGenerate(opts.apiKey!, DEFAULT_MODEL, parts, opts.signal)
    return { ok: true, text: text ?? '(empty response)' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function geminiReadDocument(
  opts: ProviderOptions,
  path: string,
  question: string,
): Promise<ProviderResult> {
  try {
    const bytes = await loadBytes(path, opts.signal)
    const b64 = Buffer.from(bytes).toString('base64')
    const parts = [
      { inlineData: { mimeType: guessMimeType(path), data: b64 } },
      { text: question || 'Summarize this document: main points, structure, and anything actionable.' },
    ]
    const { text } = await geminiGenerate(opts.apiKey!, DEFAULT_MODEL, parts, opts.signal)
    return { ok: true, text: text ?? '(empty response)' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function geminiGenerateImage(
  opts: ProviderOptions,
  prompt: string,
): Promise<ProviderResult> {
  try {
    const model = opts.imageModel ?? DEFAULT_IMAGE_MODEL
    const { inlineImage } = await geminiGenerate(
      opts.apiKey!,
      model,
      [{ text: prompt }],
      opts.signal,
    )
    if (!inlineImage) return { ok: false, error: 'no image returned by the model' }
    const dir = opts.outputDir ?? join(tmpdir(), 'dsh-gemini-multimodal')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
    writeFileSync(file, inlineImage)
    return { ok: true, text: `Image saved to ${file}`, imagePath: file }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------------------
// antigravity_cli — local `agy` on PATH
// ---------------------------------------------------------------------------

/** Build the agy argv for headless mode. Exported for tests. */
export function agyArgs(opts: ProviderOptions, prompt: string): string[] {
  const args = ['-p', prompt]
  if (opts.skipPermissions !== false) args.push('--dangerously-skip-permissions')
  return args
}

function runAgy(opts: ProviderOptions, prompt: string): Promise<ProviderResult> {
  return new Promise((resolve) => {
    const child = spawn('agy', agyArgs(opts, prompt), { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), REQUEST_TIMEOUT_MS + 30_000)
    child.stdout?.on('data', (d) => (out += String(d)))
    child.stderr?.on('data', (d) => (err += String(d)))
    child.on('error', () => {
      clearTimeout(timer)
      resolve({
        ok: false,
        error:
          'agy not found on PATH. Install: curl -fsSL https://antigravity.google/cli/install.sh | bash, ' +
          'then run `agy` once and sign in (no key needed). ' +
          'Alternatively set provider: gemini_api + api_key (aistudio.google.com).',
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = out.trim()
      if (!text) resolve({ ok: false, error: err.trim() || `agy exited with code ${code}` })
      else resolve({ ok: true, text })
    })
  })
}

function agyUnderstand(opts: ProviderOptions, source: string, question: string): Promise<ProviderResult> {
  return runAgy(opts, `Analyze this media (${source}) and answer: ${question || 'describe its content in detail.'}`)
}

function agyTranscribe(opts: ProviderOptions, source: string): Promise<ProviderResult> {
  return runAgy(opts, `Transcribe this media file (${source}) to text verbatim, with timestamps where useful.`)
}

function agyReadDocument(opts: ProviderOptions, path: string, question: string): Promise<ProviderResult> {
  return runAgy(opts, `Read the document at ${path} and ${question ? `answer: ${question}` : 'summarize its main points.'}`)
}

async function agyGenerateImage(opts: ProviderOptions, prompt: string): Promise<ProviderResult> {
  const dir = opts.outputDir ?? join(tmpdir(), 'dsh-gemini-multimodal')
  mkdirSync(dir, { recursive: true })
  const r = await runAgy(
    opts,
    `Generate an image of: ${prompt}. Save it as a PNG file inside ${dir} and reply with the full saved file path only.`,
  )
  if (!r.ok) return r
  const m = r.text?.match(/([\w./~-]+\.png)/i)
  return m ? { ok: true, text: `Image saved to ${m[1]}`, imagePath: m[1] } : r
}

// ---------------------------------------------------------------------------
// unified dispatch
// ---------------------------------------------------------------------------

export type MediaAction = 'understand' | 'transcribe' | 'read_document' | 'image_generate'

export function runProvider(opts: ProviderOptions, action: MediaAction, arg: { source?: string; question?: string; prompt?: string }): Promise<ProviderResult> {
  // No provider configured -> default to antigravity_cli so the plugin works
  // with zero config (local agy, no key).
  const provider = opts.provider ?? 'antigravity_cli'
  if (provider === 'gemini_api') {
    if (!opts.apiKey) {
      return Promise.resolve({ ok: false, error: 'provider gemini_api needs api_key — get one at aistudio.google.com, or switch to antigravity_cli (local agy, no key).' })
    }
    switch (action) {
      case 'understand': return geminiUnderstand(opts, arg.source!, arg.question ?? '')
      case 'transcribe': return geminiTranscribe(opts, arg.source!)
      case 'read_document': return geminiReadDocument(opts, arg.source!, arg.question ?? '')
      case 'image_generate': return geminiGenerateImage(opts, arg.prompt!)
    }
  }
  // antigravity_cli
  switch (action) {
    case 'understand': return agyUnderstand(opts, arg.source!, arg.question ?? '')
    case 'transcribe': return agyTranscribe(opts, arg.source!)
    case 'read_document': return agyReadDocument(opts, arg.source!, arg.question ?? '')
    case 'image_generate': return agyGenerateImage(opts, arg.prompt!)
  }
}
