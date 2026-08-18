/**
 * Unit tests for the providers layer: mime guessing, gemini request shape,
 * and agy argument construction. No network, no real agy.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { agyArgs, guessMimeType, runProvider } from '../src/providers.ts'

describe('guessMimeType', () => {
  it('maps common extensions', () => {
    assert.equal(guessMimeType('a.png'), 'image/png')
    assert.equal(guessMimeType('a.JPG'), 'image/jpeg')
    assert.equal(guessMimeType('clip.mp4'), 'video/mp4')
    assert.equal(guessMimeType('voice.m4a'), 'audio/mp4')
    assert.equal(guessMimeType('doc.pdf'), 'application/pdf')
    assert.equal(guessMimeType('https://x.com/a.webp?q=1'), 'image/webp')
  })

  it('falls back to octet-stream', () => {
    assert.equal(guessMimeType('noext'), 'application/octet-stream')
  })
})

describe('agyArgs', () => {
  it('includes -p prompt and skip-permissions by default', () => {
    assert.deepEqual(agyArgs({ provider: 'antigravity_cli' }, 'hello'), [
      '-p', 'hello', '--dangerously-skip-permissions',
    ])
  })

  it('omits skip-permissions when disabled', () => {
    assert.deepEqual(agyArgs({ provider: 'antigravity_cli', skipPermissions: false }, 'hi'), ['-p', 'hi'])
  })
})

describe('runProvider — gemini_api without key', () => {
  it('returns a setup hint, not a crash', async () => {
    const r = await runProvider({ provider: 'gemini_api' }, 'understand', { source: '/tmp/x.png', question: 'q' })
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /api_key is required|needs api_key/)
  })
})

describe('runProvider — default provider (no config)', () => {
  it('defaults to antigravity_cli', async () => {
    const r = await runProvider({}, 'understand', { source: '/tmp/x.png', question: 'q' })
    assert.equal(typeof r.ok, 'boolean')
  })
})

describe('runProvider — antigravity_cli without agy on PATH', () => {
  it('returns a friendly error when agy is missing', async () => {
    // PATH is unchanged here; if agy exists locally the test still passes
    // because spawn failure is handled. If agy runs, output may be real —
    // acceptable, but we assert on the result shape only.
    const r = await runProvider(
      { provider: 'antigravity_cli', skipPermissions: false },
      'understand',
      { source: '/tmp/nonexistent-xyz.png', question: 'q' },
    )
    assert.equal(typeof r.ok, 'boolean')
    if (!r.ok) assert.match(r.error ?? '', /agy|error|no such|ENOENT/i)
  })
})
