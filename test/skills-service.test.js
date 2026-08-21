import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  addSkillToLibrary,
  backupSkill,
  loadSkillsState,
  removeSkill,
  restoreSkill,
  syncSkillToEngines,
  syncToEngine,
  withMinimumOneEnabled,
  __testing
} from '../src/main/skills-service.js'

async function makeTempHome(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-skills-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {}))
  return dir
}

async function writeSkillDir({ parent, name, content = '---\nname: test\n---\n# Test\n', description }) {
  const dir = path.join(parent, name)
  await fs.mkdir(dir, { recursive: true })
  const header = description ? `---\nname: ${name}\ndescription: ${description}\n---\n` : content
  await fs.writeFile(path.join(dir, 'SKILL.md'), header, 'utf8')
  await fs.writeFile(path.join(dir, 'helper.mjs'), 'export default 1\n', 'utf8')
  return dir
}

test('sanitizeName rejects path separators / traversal / control chars', () => {
  assert.equal(__testing.sanitizeName('../x'), null)
  assert.equal(__testing.sanitizeName('a/b'), null)
  assert.equal(__testing.sanitizeName('a\\b'), null)
  assert.equal(__testing.sanitizeName('.'), null)
  assert.equal(__testing.sanitizeName('..'), null)
  assert.equal(__testing.sanitizeName('a\u0000b'), null)
  assert.equal(__testing.sanitizeName('valid-name'), 'valid-name')
})

test('skill filesystem operations reject traversal names', async t => {
  const home = await makeTempHome(t)
  const args = {
    libraryPath: path.join(home, 'lib'),
    skillName: '../outside',
    homePath: home,
    backupDir: path.join(home, 'backups'),
    apps: { kimi: true, claude: false, codex: false }
  }
  await assert.rejects(() => syncToEngine({ ...args, engine: 'kimi' }), /无效的 Skill 名称/)
  await assert.rejects(() => backupSkill(args), /无效的 Skill 名称/)
  await assert.rejects(() => removeSkill(args), /无效的 Skill 名称/)
})

test('withMinimumOneEnabled always keeps at least one engine, defaulting to kimi', () => {
  assert.deepEqual(withMinimumOneEnabled({}), { kimi: true, claude: false, codex: false })
  assert.deepEqual(withMinimumOneEnabled({ kimi: false, claude: false, codex: false }), { kimi: true, claude: false, codex: false })
  assert.deepEqual(withMinimumOneEnabled({ kimi: true, claude: false, codex: true }), { kimi: true, claude: false, codex: true })
  assert.deepEqual(withMinimumOneEnabled({ claude: true }), { kimi: false, claude: true, codex: false })
})

test('addSkillToLibrary copies only valid skills and rejects overwrite', async t => {
  const home = await makeTempHome(t)
  const source = await writeSkillDir({ parent: home, name: 'reviewer', description: 'desc here' })
  const ssot = path.join(home, 'lib')
  const added = await addSkillToLibrary({ libraryPath: ssot, sourceDir: source })
  assert.equal(added.name, 'reviewer')
  assert.equal(added.description, 'desc here')
  assert.deepEqual(added.apps, { kimi: true, claude: true, codex: true })
  assert.equal(await fs.stat(path.join(ssot, 'reviewer', 'helper.mjs')).then(s => s.isFile()), true)

  await assert.rejects(() => addSkillToLibrary({ libraryPath: ssot, sourceDir: source }), /已存在同名/)
  const badDir = path.join(home, 'bad')
  await fs.mkdir(badDir)
  await fs.writeFile(path.join(badDir, 'README.md'), 'no skill', 'utf8')
  await assert.rejects(() => addSkillToLibrary({ libraryPath: ssot, sourceDir: badDir }), /缺少 SKILL\.md/)
})

test('loadSkillsState returns managed list and engine diagnostics', async t => {
  const home = await makeTempHome(t)
  const lib = path.join(home, 'lib')
  await writeSkillDir({ parent: lib, name: 'alpha' })
  await writeSkillDir({ parent: lib, name: 'beta' })
  const state = await loadSkillsState({
    libraryPath: lib,
    homePath: home,
    override: { claude: path.join(home, 'custom-claude'), codex: path.join(home, 'custom-codex') }
  })
  assert.equal(state.managed.length, 2)
  assert.deepEqual(state.managed.map(s => s.name).sort(), ['alpha', 'beta'])
  assert.equal(state.diagnostics.kimi.method, 'pointer')
  assert.equal(state.diagnostics.claude.directory, path.join(home, 'custom-claude'))
  assert.equal(state.diagnostics.claude.enabled, 2)
  assert.equal(state.diagnostics.codex.enabled, 2)

  const persisted = await loadSkillsState({
    libraryPath: lib,
    homePath: home,
    managedConfig: { alpha: { apps: { kimi: false, claude: true, codex: false } } }
  })
  assert.deepEqual(persisted.managed.find(skill => skill.name === 'alpha').apps, {
    kimi: false,
    claude: true,
    codex: false
  })
})

test('syncToEngine: symlink path works and copy fallback works', async t => {
  const home = await makeTempHome(t)
  const lib = path.join(home, 'lib')
  const source = path.join(lib, 'demo')
  await writeSkillDir({ parent: lib, name: 'demo' })
  const targetClaude = path.join(home, 'claude', 'skills')
  const targetCodex = path.join(home, 'codex', 'skills')

  const r1 = await syncToEngine({ libraryPath: lib, skillName: 'demo', engine: 'claude', homePath: home, override: { claude: targetClaude } })
  assert.equal(r1.ok, true)
  assert.equal(r1.method, 'symlink')
  assert.equal(await fs.lstat(path.join(targetClaude, 'demo')).then(s => s.isSymbolicLink()), true)

  // 显式 copy 生成真实目录
  const r2 = await syncToEngine({ libraryPath: lib, skillName: 'demo', engine: 'codex', homePath: home, override: { codex: targetCodex }, method: 'copy' })
  assert.equal(r2.ok, true)
  assert.equal(r2.method, 'copy')
  assert.equal(await fs.stat(path.join(targetCodex, 'demo', 'helper.mjs')).then(s => s.isFile()), true)
})

test('syncToEngine: conflict with user-managed real directory is not overwritten', async t => {
  const home = await makeTempHome(t)
  const lib = path.join(home, 'lib')
  await writeSkillDir({ parent: lib, name: 'demo' })
  const target = path.join(home, 'claude', 'skills')
  await writeSkillDir({ parent: target, name: 'demo', content: '# user owned\n' })
  const r = await syncToEngine({ libraryPath: lib, skillName: 'demo', engine: 'claude', homePath: home, override: { claude: target } })
  assert.equal(r.ok, false)
  assert.equal(r.conflict, true)
  // 用户内容未被触碰
  const kept = await fs.readFile(path.join(target, 'demo', 'SKILL.md'), 'utf8')
  assert.match(kept, /user owned/)
})

test('syncToEngine: foreign symlink is not replaced', async t => {
  const home = await makeTempHome(t)
  const lib = path.join(home, 'lib')
  const foreign = path.join(home, 'foreign')
  await writeSkillDir({ parent: lib, name: 'demo' })
  await writeSkillDir({ parent: home, name: 'foreign' })
  const target = path.join(home, 'claude', 'skills')
  await fs.mkdir(target, { recursive: true })
  await fs.symlink(foreign, path.join(target, 'demo'), 'dir')
  const result = await syncToEngine({
    libraryPath: lib,
    skillName: 'demo',
    engine: 'claude',
    homePath: home,
    override: { claude: target }
  })
  assert.equal(result.ok, false)
  assert.equal(result.conflict, true)
  assert.equal(await fs.readlink(path.join(target, 'demo')), foreign)
})

test('syncToEngine: foreign files are not overwritten', async t => {
  const home = await makeTempHome(t)
  const lib = path.join(home, 'lib')
  const target = path.join(home, 'codex', 'skills')
  await writeSkillDir({ parent: lib, name: 'demo' })
  await fs.mkdir(target, { recursive: true })
  const destination = path.join(target, 'demo')
  await fs.writeFile(destination, 'user-owned file')
  const result = await syncToEngine({
    libraryPath: lib,
    skillName: 'demo',
    engine: 'codex',
    homePath: home,
    override: { codex: target },
    method: 'copy'
  })
  assert.equal(result.ok, false)
  assert.equal(result.conflict, true)
  assert.equal(await fs.readFile(destination, 'utf8'), 'user-owned file')
})

test('syncSkillToEngines respects apps matrix and reports per-engine', async t => {
  const home = await makeTempHome(t)
  const lib = path.join(home, 'lib')
  await writeSkillDir({ parent: lib, name: 'demo' })
  const override = {
    claude: path.join(home, 'claude'),
    codex: path.join(home, 'codex')
  }
  const results = await syncSkillToEngines({
    libraryPath: lib,
    skillName: 'demo',
    apps: { kimi: true, claude: true, codex: false },
    homePath: home,
    override
  })
  assert.deepEqual(Object.keys(results).sort(), ['claude', 'kimi'])
  assert.equal(results.claude.ok, true)
  assert.equal(results.kimi.ok, true)
  await assert.rejects(() => fs.access(path.join(override.codex, 'demo')))
})

test('removeSkill: backs up then removes from enabled engines and ssot', async t => {
  const home = await makeTempHome(t)
  const lib = path.join(home, 'lib')
  await writeSkillDir({ parent: lib, name: 'demo' })
  const override = {
    claude: path.join(home, 'claude'),
    codex: path.join(home, 'codex')
  }
  const apps = { kimi: true, claude: true, codex: false }
  // 预置一个 Claude 投影链接
  await syncToEngine({ libraryPath: lib, skillName: 'demo', engine: 'claude', homePath: home, override })
  const backupDir = path.join(home, 'backups')
  const removed = await removeSkill({ libraryPath: lib, skillName: 'demo', homePath: home, override, backupDir, apps })
  assert.ok(removed.backupPath)
  assert.equal(await fs.stat(removed.backupPath).then(s => s.isDirectory()), true)
  await assert.rejects(() => fs.access(path.join(override.claude, 'demo')))
  await assert.rejects(() => fs.access(path.join(lib, 'demo')))
})

test('copy projections are marked and can be safely removed, then restored', async t => {
  const home = await makeTempHome(t)
  const lib = path.join(home, 'lib')
  const target = path.join(home, 'codex', 'skills')
  await writeSkillDir({ parent: lib, name: 'demo' })
  await syncToEngine({
    libraryPath: lib,
    skillName: 'demo',
    engine: 'codex',
    homePath: home,
    override: { codex: target },
    method: 'copy'
  })
  await fs.writeFile(path.join(lib, 'demo', 'SKILL.md'), '# Updated')
  const resynced = await syncToEngine({
    libraryPath: lib,
    skillName: 'demo',
    engine: 'codex',
    homePath: home,
    override: { codex: target },
    method: 'copy'
  })
  assert.equal(resynced.ok, true)
  assert.equal(await fs.readFile(path.join(target, 'demo', 'SKILL.md'), 'utf8'), '# Updated')
  const backupDir = path.join(home, 'backups')
  const removed = await removeSkill({
    libraryPath: lib,
    skillName: 'demo',
    homePath: home,
    override: { codex: target },
    backupDir,
    apps: { kimi: false, claude: false, codex: true }
  })
  assert.equal(removed.removal.codex, 'removed')
  await assert.rejects(() => fs.access(path.join(target, 'demo')))
  const restored = await restoreSkill({
    libraryPath: lib,
    skillName: 'demo',
    backupDir,
    backupPath: removed.backupPath
  })
  assert.equal(restored.name, 'demo')
  assert.equal(await fs.stat(path.join(lib, 'demo', 'SKILL.md')).then(stat => stat.isFile()), true)
})

test('restoreSkill rejects a backup path outside the backup directory', async t => {
  const home = await makeTempHome(t)
  await assert.rejects(() => restoreSkill({
    libraryPath: path.join(home, 'lib'),
    skillName: 'demo',
    backupDir: path.join(home, 'backups'),
    backupPath: path.join(home, 'outside')
  }), /备份路径不在 Skill 备份目录中/)
})

test('backupSkill creates timestamped backup directory', async t => {
  const home = await makeTempHome(t)
  const lib = path.join(home, 'lib')
  await writeSkillDir({ parent: lib, name: 'demo' })
  const backupDir = path.join(home, 'backups')
  const backup = await backupSkill({ libraryPath: lib, skillName: 'demo', backupDir })
  assert.ok(backup)
  assert.equal(await fs.stat(path.join(backup, 'SKILL.md')).then(s => s.isFile()), true)
  // 不存在则返回 null
  const none = await backupSkill({ libraryPath: lib, skillName: 'nope', backupDir })
  assert.equal(none, null)
})

test('engineTargetDir honors custom override and defaults', () => {
  assert.equal(__testing.engineTargetDir('claude', 'C:/Users/u', {}), path.join('C:/Users/u', '.claude', 'skills'))
  assert.equal(__testing.engineTargetDir('codex', 'C:/Users/u', {}), path.join('C:/Users/u', '.agents', 'skills'))
  assert.equal(__testing.engineTargetDir('kimi', 'C:/Users/u', {}), null)
  assert.equal(__testing.engineTargetDir('claude', 'C:/Users/u', { claude: 'D:/custom/skills' }), path.resolve('D:/custom/skills'))
})


