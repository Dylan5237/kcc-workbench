import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  SettingsService,
  parseManagedConfig,
  patchTomlValue
} from '../src/main/settings-service.js'

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
