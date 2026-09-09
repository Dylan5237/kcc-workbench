// K1-D0 (#34): Dogfood 记录的 build 溯源。只认与 exe 相邻的确定性打包布局
// (#25 scripts/package-dev.ps1): <dist>/win-unpacked/Arckeep.exe 旁边的
// <dist>/build-info.json。dev 运行或其他布局下一律 null, 绝不向目录上级
// 漫游查找, 也绝不阻塞保存。
import { promises as fs } from 'node:fs'
import path from 'node:path'

const COMMIT_PATTERN = /^[0-9a-f]{40}$/

export async function readBuildSourceCommit(exePath) {
  try {
    const buildInfoPath = path.join(path.dirname(path.dirname(exePath)), 'build-info.json')
    const info = JSON.parse(await fs.readFile(buildInfoPath, 'utf8'))
    return typeof info?.sourceCommit === 'string' && COMMIT_PATTERN.test(info.sourceCommit)
      ? info.sourceCommit
      : null
  } catch {
    return null
  }
}
