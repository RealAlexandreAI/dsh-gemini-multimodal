// Cordis runtime smoke test: mount the plugin into a real Cordis Context with
// minimal service stubs and assert the 4 tools register + inject completeness.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, inject, name } from '../src/index.ts'

function makeCtx() {
  const ctx = new Context()
  const registered = []
  ctx.provide('tools', { register(tool) { registered.push(tool) } })
  ctx.provide('systemPrompt', { section() {} })
  return { ctx, registered }
}

describe('dsh-gemini-multimodal smoke', () => {
  it('declares every accessed service in inject', () => {
    assert.deepEqual(inject.sort(), ['systemPrompt', 'tools'])
    assert.equal(name, 'gemini-multimodal')
  })

  it('registers the 4 tools', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx, { provider: 'gemini_api' })
    const names = registered.map((t) => t.name).sort()
    assert.deepEqual(names, ['image_generate', 'media_transcribe', 'media_understand', 'read_document'])
  })

  it('loads with NO config at all (zero-config: defaults to antigravity_cli)', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx, {})
    assert.equal(registered.length, 4)
    const bare = Config['~standard'].validate({})
    assert.equal(bare.issues === undefined || bare.issues.length === 0, true)
  })
})
