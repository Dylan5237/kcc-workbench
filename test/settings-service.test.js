import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  SettingsService,
  hasEngineConfigChanged,
  parseManagedConfig,
  patchTomlValue,
  applyModelsToToml
} from '../src/main/settings-service.js'


test('detects any engine config change regardless of key order', () => {
  assert.equal(hasEngineConfigChanged({ a: 1 }, { a: 1 }), false)
  assert.equal(hasEngineConfigChanged({ a: 1 }, { a: 2 }), true)
  assert.equal(hasEngineConfigChanged({ a: 1, b: 2 }, { b: 2, a: 1 }), false)
  assert.equal(
    hasEngineConfigChanged({ thinking: { enabled: true } }, { thinking: { enabled: false } }),
    true
  )
  assert.equal(
    hasEngineConfigChanged({ thinking: { enabled: true, effort: 'high' } }, { thinking: { effort: 'high', enabled: true } }),
    false
  )
  assert.equal(hasEngineConfigChanged({}, {}), false)
  assert.equal(hasEngineConfigChanged(null, { a: 1 }), true)
})

test('reads managed fields without changing unknown configuration', () => {
  const text = `# keep me
default_model = "kimi-code/k3"
unknown_key = "untouched"

[thinking]
enabled = true # keep comment
effort = "high"
`
  assert.deepEqual(parseManagedConfig(text), {
    default_model: 'kimi-code/k3',
    thinking: { enabled: true, effort: 'high' }
  })
  const patched = patchTomlValue(text, 'thinking', 'enabled', 'false')
  assert.match(patched, /enabled = false # keep comment/)
  assert.match(patched, /unknown_key = "untouched"/)
})

test('updates quoted TOML sections without appending a duplicate section', () => {
  const text = `["loop_control"] # keep quoted header
max_steps_per_turn = 8

[custom]
value = "untouched"
`
  const patched = patchTomlValue(text, 'loop_control', 'max_steps_per_turn', '12')
  assert.match(patched, /\["loop_control"\] # keep quoted header/)
  assert.match(patched, /max_steps_per_turn = 12/)
  assert.equal((patched.match(/loop_control/g) || []).length, 1)
  assert.match(patched, /\[custom\]\nvalue = "untouched"/)
})

test('rejects semantically duplicate TOML sections before writing', () => {
  const text = `["thinking"]
enabled = true

[thinking]
effort = "high"
`
  assert.throws(
    () => patchTomlValue(text, 'thinking', 'enabled', 'false'),
    /重复节/
  )
})

test('applyModelsToToml adds models and preserves non-model content', () => {
  const text = `default_model = "kimi-code/k3"

[thinking]
enabled = true
`
  const next = applyModelsToToml(text, [
    {
      alias: 'my-gpt',
      model: 'gpt-4',
      provider: 'openai-compatible',
      apiKey: 'sk-x',
      baseUrl: 'https://api.x.com/v1'
    }
  ])
  assert.match(next, /default_model = "kimi-code\/k3"/)
  assert.match(next, /\[thinking\]\nenabled = true/)
  assert.match(next, /\[models\."my-gpt"\]/)
  assert.match(next, /model = "gpt-4"/)
  assert.match(next, /provider = "openai-compatible"/)
  assert.match(next, /api_key = "sk-x"/)
  assert.match(next, /base_url = "https:\/\/api.x.com\/v1"/)
})

test('applyModelsToToml updates an existing model in place', () => {
  const text = `[models."old"]
model = "gpt-3"
`
  const next = applyModelsToToml(text, [
    { alias: 'old', model: 'gpt-4o', displayName: 'GPT-4o', maxContextSize: 128000, capabilities: ['text'] }
  ])
  assert.match(next, /\[models\."old"\]\nmodel = "gpt-4o"\ndisplay_name = "GPT-4o"/)
  assert.match(next, /max_context_size = 128000/)
  assert.match(next, /capabilities = \["text"\]/)
  assert.doesNotMatch(next, /gpt-3/)
})

test('applyModelsToToml preserves unknown model fields and nested tables', () => {
  const text = `[models."custom"]
model = "old"
custom_option = "keep"

[models."custom".headers]
X-Trace = "enabled"
`
  const next = applyModelsToToml(text, [{ alias: 'custom', model: 'new' }])
  assert.match(next, /model = "new"/)
  assert.match(next, /custom_option = "keep"/)
  assert.match(next, /\[models\."custom"\.headers\]\nX-Trace = "enabled"/)
})

test('applyModelsToToml safely serializes aliases and rejects ambiguous model lists', () => {
  const next = applyModelsToToml('', [{ alias: 'vendor"blue', model: 'gpt-4' }])
  assert.match(next, /\[models\."vendor\\"blue"\]/)
  assert.throws(
    () => applyModelsToToml('', [{ alias: 'bad\ntelemetry = true', model: 'gpt-4' }]),
    /控制字符/
  )
  assert.throws(
    () => applyModelsToToml('', [
      { alias: 'duplicate', model: 'one' },
      { alias: 'duplicate', model: 'two' }
    ]),
    /重复/
  )
})

test('applyModelsToToml leaves unsupported unquoted model sections untouched', () => {
  const text = `[models.legacy]
model = "legacy"
custom_option = true
`
  const next = applyModelsToToml(text, [{ alias: 'new', model: 'gpt-4' }])
  assert.match(next, /\[models\.legacy\]\nmodel = "legacy"\ncustom_option = true/)
  assert.match(next, /\[models\."new"\]/)
})

test('applyModelsToToml removes all models when empty list passed', () => {
  const text = `default_model = "x"

[models."gone"]
model = "gpt-4"

[models."gone".headers]
X-Test = "remove"
`
  const next = applyModelsToToml(text, [])
  assert.doesNotMatch(next, /\[models/)
  assert.match(next, /default_model = "x"/)
})

test('saves into an isolated home and creates backups', async t => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-settings-'))
  t.after(() => fs.rm(tempHome, { recursive: true, force: true }))
  await fs.writeFile(
    path.join(tempHome, 'config.toml'),
    'default_model = "old"\ncustom = 42\n'
  )

  const service = new SettingsService({ kimiCodeHome: tempHome, sandboxed: true })
  await service.save({
    config: {
      default_model: 'kimi-code/k3',
      default_permission_mode: 'manual',
      thinking: { enabled: true, effort: 'high' }
    },
    systemPrompt: 'You are Kimi.\n\n${base_prompt}\n',
    agentsInstructions: 'Always run tests.\n'
  })

  const config = await fs.readFile(path.join(tempHome, 'config.toml'), 'utf8')
  assert.match(config, /default_model = "kimi-code\/k3"/)
  assert.match(config, /custom = 42/)
  assert.match(config, /\[thinking\]/)
  assert.equal(
    await fs.readFile(path.join(tempHome, 'SYSTEM.md'), 'utf8'),
    'You are Kimi.\n\n${base_prompt}\n'
  )
  assert.equal(
    await fs.readFile(path.join(tempHome, 'config.toml.bak'), 'utf8'),
    'default_model = "old"\ncustom = 42\n'
  )
})

test('does not touch config when only prompts change and removes cleared prompt safely', async t => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-settings-'))
  t.after(() => fs.rm(tempHome, { recursive: true, force: true }))
  const configPath = path.join(tempHome, 'config.toml')
  const promptPath = path.join(tempHome, 'SYSTEM.md')
  await fs.writeFile(configPath, 'custom = 42\n')
  await fs.writeFile(promptPath, 'Old prompt\n')

  const service = new SettingsService({ kimiCodeHome: tempHome, sandboxed: true })
  await service.save({ systemPrompt: '' })

  assert.equal(await fs.readFile(configPath, 'utf8'), 'custom = 42\n')
  await assert.rejects(fs.access(promptPath), { code: 'ENOENT' })
  assert.equal(await fs.readFile(`${promptPath}.bak`, 'utf8'), 'Old prompt\n')
})

test('reports built-in prompt state and discovers skills without writing configuration', async t => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-settings-'))
  t.after(() => fs.rm(tempHome, { recursive: true, force: true }))
  const skillDirectory = path.join(tempHome, 'skills', 'reviewer')
  await fs.mkdir(skillDirectory, { recursive: true })
  await fs.writeFile(path.join(skillDirectory, 'SKILL.md'), '# Reviewer\n')

  const service = new SettingsService({ kimiCodeHome: tempHome, sandboxed: true })
  const state = await service.getState()

  assert.equal(state.promptSources.system, 'builtin')
  assert.deepEqual(state.skills, [{
    name: 'reviewer',
    path: skillDirectory,
    source: 'Kimi Code'
  }])
  await assert.rejects(fs.access(path.join(tempHome, 'config.toml')), { code: 'ENOENT' })
})
