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

  it('loads with no api_key (surfaces on tool calls, not at boot)', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx, { provider: 'gemini_api' })
    assert.equal(registered.length, 4)
  })

  it('config schema validates required provider', () => {
    const missing = Config['~standard'].validate({})
    assert.equal((missing.issues?.length ?? 0) > 0, true)
    const ok = Config['~standard'].validate({ provider: 'antigravity_cli' })
    assert.equal(ok.issues === undefined || ok.issues.length === 0, true)
  })

  it('rejects an unknown provider at load time', () => {
    const { ctx } = makeCtx()
    assert.throws(() => apply(ctx, { provider: 'nope' }), /provider must be/)
  })
})
