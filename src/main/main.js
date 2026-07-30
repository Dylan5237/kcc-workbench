import {
  app,
  BaseWindow,
  BrowserWindow,
  dialog,
  WebContentsView,
  ipcMain,
  net,
  protocol,
  session,
  shell
} from 'electron'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import { QuotaService } from './quota-service.js'
import { runQuotaFixtureSelfTest } from './quota-worker.js'
import { QUOTA_EXTRACTION_SCRIPT } from './quota-extract.js'
import { LocalKimiService } from './local-kimi-service.js'
import { SettingsService } from './settings-service.js'
import { copyPathsToWindowsClipboard } from './windows-file-clipboard.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { startServer: startViewerServer } = require('../viewer/server.cjs')
const rendererRoot = path.resolve(__dirname, '../renderer')
const TITLEBAR_HEIGHT = 44
const POPUP_WIDTH = 382
const WINDOW_CONTROLS_WIDTH = 142
const SESSION_PARTITION = 'persist:kimi'
const QUOTA_URL = 'https://www.kimi.com/membership/subscription?tab=quota'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false
    }
  }
])

let mainWindow = null
let shellView = null
let kimiView = null
let viewerView = null
let settingsView = null
let quotaView = null
let viewerServer = null
let activeTab = 'kimi'
let quotaVisible = false
let quotaPreferredHeight = 620
let quotaService = null
let localKimiService = null
let settingsService = null
let loginWindow = null
let loginPromise = null
let demoMode = false

app.setName('Kimi Desktop')
const isDemoLaunch = process.argv.includes('--demo')
if (isDemoLaunch) {
  const demoProfile = (argumentValue('--demo-profile=') || 'default')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 40)
  app.setPath(
    'userData',
    path.join(app.getPath('temp'), `KimiDesktopDemo-${demoProfile || 'default'}`)
  )
}
const selfTestRequested = process.argv.some(value =>
  value.startsWith('--self-test-quota=')
)
const hasSingleInstanceLock = selfTestRequested || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  await registerAppProtocol()

  const selfTestPath = argumentValue('--self-test-quota=')
  if (selfTestPath) {
    await runSelfTestMode(selfTestPath)
    app.quit()
    return
  }

  demoMode = process.argv.includes('--demo')
  const settingsSandboxed = demoMode || process.argv.includes('--settings-sandbox')
  const kimiCodeHome = settingsSandboxed
    ? path.join(app.getPath('userData'), 'kimi-code-settings-sandbox')
    : path.resolve(
        process.env.KIMI_CODE_HOME
        || path.join(app.getPath('home'), '.kimi-code')
      )
  settingsService = new SettingsService({
    kimiCodeHome,
    sandboxed: settingsSandboxed
  })
  quotaService = new QuotaService({
    userDataPath: app.getPath('userData'),
    partition: SESSION_PARTITION,
    demoMode,
    loginHandler: openKimiLoginWindow,
    onStateChange: broadcastQuotaState
  })
  await quotaService.initialize()
  localKimiService = new LocalKimiService({
    homePath: app.getPath('home'),
    logPath: path.join(app.getPath('userData'), 'kimi-web.log')
  })
  viewerServer = await startViewerServer({
    port: 0,
    configDir: app.getPath('userData')
  })
  configureRemoteSession()
  await createMainWindow()
}).catch(async error => {
  const detail = error instanceof Error ? error.stack || error.message : String(error)
  console.error(detail)
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(path.join(app.getPath('userData'), 'fatal-error.log'), detail)
  } catch {
    // The dialog below is the final fallback when the diagnostic file cannot be written.
  }
  dialog.showErrorBox('Kimi Desktop 无法启动', detail)
  app.quit()
})

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    createMainWindow()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  quotaService?.dispose()
  localKimiService?.stop()
  viewerServer?.close()
})

async function registerAppProtocol() {
  protocol.handle('app', async request => {
    const url = new URL(request.url)
    if (url.host !== 'shell') {
      return new Response('Not Found', { status: 404 })
    }

    const requested = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'shell.html'
    const normalized = path.normalize(requested)
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      return new Response('Forbidden', { status: 403 })
    }

    const filePath = path.join(rendererRoot, normalized)
    if (!filePath.startsWith(rendererRoot)) {
      return new Response('Forbidden', { status: 403 })
    }

    try {
      await fs.access(filePath)
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}

function configureRemoteSession() {
  const remoteSession = session.fromPartition(SESSION_PARTITION)
  configurePermissionPolicy(remoteSession, webContents => isAllowedKimiLoginUrl(webContents.getURL()))
  configurePermissionPolicy(
    session.defaultSession,
    webContents => isAllowedKimiCodeUrl(webContents.getURL())
  )
}

function configurePermissionPolicy(targetSession, isTrustedContents) {
  const safePermissions = new Set(['clipboard-sanitized-write', 'fullscreen'])
  targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(Boolean(webContents) && isTrustedContents(webContents) && safePermissions.has(permission))
  })
  targetSession.setPermissionCheckHandler((webContents, permission) => {
    return Boolean(webContents) && isTrustedContents(webContents) && safePermissions.has(permission)
  })
}

async function createMainWindow() {
  const savedState = await readWindowState()
  mainWindow = new BaseWindow({
    width: savedState?.width ?? 1280,
    height: savedState?.height ?? 820,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '../renderer/assets/kimi-code-logo.png'),
    title: 'Kimi Desktop',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#fafafa',
      symbolColor: '#1d1d1f',
      height: TITLEBAR_HEIGHT
    }
  })

  createShellView()
  wireIpc()
  await shellView.webContents.loadURL('app://shell/shell.html')
  createKimiView()
  createViewerView()
  createSettingsView()
  createQuotaView()

  mainWindow.on('resize', layoutViews)
  mainWindow.on('maximize', layoutViews)
  mainWindow.on('unmaximize', layoutViews)
  mainWindow.on('show', layoutViews)
  layoutViews()

  if (savedState?.isMaximized) {
    mainWindow.maximize()
  }

  mainWindow.show()
  layoutViews()
  setImmediate(() => {
    if (mainWindow && !mainWindow.isDestroyed()) layoutViews()
  })
  mainWindow.focus()
  if (demoMode) {
    setTimeout(() => {
      if (!quotaVisible && mainWindow && !mainWindow.isDestroyed()) {
        toggleQuotaPopup()
      }
    }, 500)
  }

  mainWindow.on('blur', closeQuotaPopup)
  mainWindow.on('close', () => {
    saveWindowState().catch(() => {})
  })
  mainWindow.on('closed', () => {
    quotaVisible = false
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.close()
    }
    for (const view of [shellView, kimiView, viewerView, settingsView, quotaView]) {
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    }
    shellView = null
    quotaView = null
    kimiView = null
    viewerView = null
    settingsView = null
    mainWindow = null
  })

  broadcastQuotaState(quotaService.getState())
}

function createShellView() {
  shellView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/shell.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  shellView.setBackgroundColor('#fafafa')
  mainWindow.contentView.addChildView(shellView)
}

function createKimiView() {
  kimiView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  kimiView.setBackgroundColor('#ffffff')
  mainWindow.contentView.addChildView(kimiView)

  kimiView.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedKimiCodeUrl(url)) {
      kimiView.webContents.loadURL(url)
    } else if (isSafeExternalUrl(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  kimiView.webContents.on('will-navigate', (event, url) => {
    if (isAllowedKimiCodeUrl(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  })

  for (const eventName of [
    'did-navigate',
    'did-navigate-in-page',
    'did-start-loading',
    'did-stop-loading',
    'page-title-updated'
  ]) {
    kimiView.webContents.on(eventName, sendNavigationState)
  }
  kimiView.webContents.on('focus', closeQuotaPopup)

  if (demoMode) {
    kimiView.webContents.loadURL('app://shell/demo-kimi.html')
  } else {
    connectLocalKimiView()
  }
}

function createViewerView() {
  viewerView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/viewer.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  viewerView.setBackgroundColor('#ffffff')
  viewerView.webContents.on('focus', closeQuotaPopup)
  viewerView.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  viewerView.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`http://127.0.0.1:${viewerServer.port}/`)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  })
  viewerView.webContents.loadURL(
    `http://127.0.0.1:${viewerServer.port}/?token=${encodeURIComponent(viewerServer.bootstrapToken)}`
  )
}

function createSettingsView() {
  settingsView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/settings.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  settingsView.setBackgroundColor('#f6f6f6')
  settingsView.webContents.on('focus', closeQuotaPopup)
  settingsView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  settingsView.webContents.on('will-navigate', event => event.preventDefault())
  settingsView.webContents.loadURL('app://shell/settings.html')
}

function createQuotaView() {
  quotaView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/quota.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  quotaView.setBackgroundColor('#00000000')
  quotaView.webContents.loadURL('app://shell/quota.html')
}

function layoutViews() {
  if (!mainWindow || !shellView || !kimiView || !viewerView || !settingsView) return
  const [width, height] = mainWindow.getContentSize()
  shellView.setBounds({
    x: 0,
    y: 0,
    width,
    height: TITLEBAR_HEIGHT
  })
  const contentBounds = {
    x: 0,
    y: TITLEBAR_HEIGHT,
    width,
    height: Math.max(0, height - TITLEBAR_HEIGHT)
  }
  kimiView.setBounds(contentBounds)
  viewerView.setBounds(contentBounds)
  settingsView.setBounds(contentBounds)

  if (quotaView) {
    const availableHeight = Math.max(360, height - TITLEBAR_HEIGHT)
    quotaView.setBounds({
      x: Math.max(10, width - POPUP_WIDTH - WINDOW_CONTROLS_WIDTH),
      y: TITLEBAR_HEIGHT,
      width: POPUP_WIDTH,
      height: Math.min(quotaPreferredHeight, availableHeight)
    })
  }
}

async function switchTab(nextTab) {
  if (!mainWindow || !shellView || !kimiView || !viewerView || !settingsView) return
  if (!['kimi', 'viewer', 'settings'].includes(nextTab) || nextTab === activeTab) return
  closeQuotaPopup()

  const views = {
    kimi: kimiView,
    viewer: viewerView,
    settings: settingsView
  }
  const previousView = views[activeTab]
  const nextView = views[nextTab]
  mainWindow.contentView.removeChildView(previousView)
  mainWindow.contentView.addChildView(nextView)
  activeTab = nextTab

  if (activeTab === 'viewer') {
    const context = await detectKimiWorkspaceContext()
    if (context?.projectDirectory) {
      viewerServer.setConversationContext({
        id: context.sessionId ? `kimi:${context.sessionId}` : `workspace:${context.projectDirectory.toLowerCase()}`,
        label: context.sessionId ? '当前 Kimi 对话' : '当前工作区',
        root: context.projectDirectory
      })
    }
  }
  if (activeTab === 'settings') {
    settingsService.setProjectDirectory(await detectKimiProjectDirectory())
  }

  layoutViews()
  nextView.webContents.focus()
  shellView.webContents.send('shell:tab-changed', {
    activeTab,
    viewerRoot: viewerServer.root
  })
}

function toggleQuotaPopup() {
  if (!mainWindow || !quotaView) return
  if (quotaVisible) {
    closeQuotaPopup()
    return
  }

  quotaVisible = true
  mainWindow.contentView.addChildView(quotaView)
  layoutViews()
  quotaView.webContents.focus()
  quotaView.webContents.send('quota:state', quotaService.getState())
  shellView.webContents.send('quota:visibility', true)
}

function closeQuotaPopup() {
  if (!quotaVisible || !mainWindow || !quotaView) return
  quotaVisible = false
  mainWindow.contentView.removeChildView(quotaView)
  shellView.webContents.send('quota:visibility', false)
}

function wireIpc() {
  ipcMain.removeHandler('shell:get-state')
  ipcMain.removeHandler('shell:set-tab')
  ipcMain.removeHandler('shell:toggle-quota')
  ipcMain.removeHandler('nav:back')
  ipcMain.removeHandler('nav:forward')
  ipcMain.removeHandler('nav:reload')
  ipcMain.removeHandler('quota:get-state')
  ipcMain.removeHandler('quota:refresh')
  ipcMain.removeHandler('quota:close')
  ipcMain.removeHandler('quota:set-preferred-height')
  ipcMain.removeHandler('viewer:select-directory')
  ipcMain.removeHandler('viewer:set-root')
  ipcMain.removeHandler('viewer:fork-checkpoint')
  ipcMain.removeHandler('viewer:copy-files')
  ipcMain.removeHandler('settings:get-state')
  ipcMain.removeHandler('settings:save')
  ipcMain.removeHandler('settings:select-directory')

  ipcMain.handle('shell:get-state', event => {
    requireSender(event, shellView.webContents)
    return {
      quota: quotaService.getState(),
      navigation: navigationState(),
      activeTab,
      viewerRoot: viewerServer.root
    }
  })
  ipcMain.handle('shell:set-tab', (event, nextTab) => {
    requireSender(event, shellView.webContents)
    return switchTab(nextTab)
  })
  ipcMain.handle('shell:toggle-quota', event => {
    requireSender(event, shellView.webContents)
    toggleQuotaPopup()
  })
  ipcMain.handle('nav:back', event => {
    requireSender(event, shellView.webContents)
    const history = kimiView.webContents.navigationHistory
    if (history.canGoBack()) history.goBack()
  })
  ipcMain.handle('nav:forward', event => {
    requireSender(event, shellView.webContents)
    const history = kimiView.webContents.navigationHistory
    if (history.canGoForward()) history.goForward()
  })
  ipcMain.handle('nav:reload', event => {
    requireSender(event, shellView.webContents)
    if (kimiView.webContents.getURL().startsWith('app://shell/service-')) {
      connectLocalKimiView()
    } else {
      kimiView.webContents.reload()
    }
  })
  ipcMain.handle('quota:get-state', event => {
    requireSender(event, quotaView.webContents)
    return quotaService.getState()
  })
  ipcMain.handle('quota:refresh', async event => {
    requireSender(event, quotaView.webContents)
    return quotaService.refresh()
  })
  ipcMain.handle('quota:close', event => {
    requireSender(event, quotaView.webContents)
    closeQuotaPopup()
  })
  ipcMain.handle('quota:set-preferred-height', (event, height) => {
    requireSender(event, quotaView.webContents)
    if (!Number.isFinite(height)) return
    quotaPreferredHeight = Math.max(360, Math.min(1200, Math.ceil(height)))
    layoutViews()
  })
  ipcMain.handle('viewer:select-directory', async event => {
    requireSender(event, viewerView.webContents)
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要监听的项目文件夹',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('viewer:set-root', (event, nextRoot) => {
    requireSender(event, viewerView.webContents)
    if (typeof nextRoot !== 'string' || nextRoot.length > 4096) {
      throw new Error('项目目录无效')
    }
    if (!viewerServer.setRoot(nextRoot.trim())) {
      throw new Error(`目录不存在：${nextRoot.trim()}`)
    }
    return { root: viewerServer.root }
  })
  ipcMain.handle('viewer:fork-checkpoint', async (event, input) => {
    requireSender(event, viewerView.webContents)
    const payload = normalizeForkRequest(input)
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '创建隔离分支',
      message: `确认创建分支 ${payload.branchName}？`,
      detail: '这会在磁盘上创建新的 Git worktree，并恢复所选时间点的改动。',
      buttons: ['取消', '创建并恢复'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (confirmation.response !== 1) throw new Error('已取消创建隔离分支')
    return viewerServer.forkCheckpoint(payload)
  })
  ipcMain.handle('viewer:copy-files', async (event, paths) => {
    requireSender(event, viewerView.webContents)
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('没有可复制的文件')
    }
    const canonicalRoot = await fs.realpath(viewerServer.root)
    const safePaths = []
    for (const value of paths) {
      const canonicalPath = await fs.realpath(path.resolve(String(value)))
      if (
        canonicalPath !== canonicalRoot
        && !canonicalPath.startsWith(`${canonicalRoot}${path.sep}`)
      ) {
        throw new Error('文件不在当前项目目录中')
      }
      safePaths.push(canonicalPath)
    }
    for (const filePath of safePaths) {
      const stat = await fs.stat(filePath)
      if (!stat.isFile() && !stat.isDirectory()) {
        throw new Error(`无法复制该路径：${filePath}`)
      }
    }
    await copyPathsToWindowsClipboard(safePaths)
    return true
  })
  ipcMain.handle('settings:get-state', async event => {
    requireSender(event, settingsView.webContents)
    settingsService.setProjectDirectory(await detectKimiProjectDirectory())
    return settingsService.getState()
  })
  ipcMain.handle('settings:save', async (event, payload) => {
    requireSender(event, settingsView.webContents)
    return settingsService.save(payload || {})
  })
  ipcMain.handle('settings:select-directory', async event => {
    requireSender(event, settingsView.webContents)
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Skills 或 Agent 目录',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

function requireSender(event, expectedWebContents) {
  if (!expectedWebContents || event.sender.id !== expectedWebContents.id) {
    throw new Error('Blocked IPC from an unexpected renderer')
  }
}

function normalizeForkRequest(input) {
  if (!input || typeof input !== 'object') throw new Error('分叉参数无效')
  const checkpointId = String(input.checkpointId || '').trim()
  const branchName = String(input.branchName || '').trim()
  const targetPath = String(input.targetPath || '').trim()
  if (!checkpointId || checkpointId.length > 200) throw new Error('时间点无效')
  if (!branchName || branchName.length > 120) throw new Error('分支名无效')
  if (targetPath.length > 4096) throw new Error('目标目录无效')
  return { checkpointId, branchName, targetPath }
}

function sendNavigationState() {
  if (!mainWindow || mainWindow.isDestroyed() || !shellView) return
  shellView.webContents.send('navigation:state', navigationState())
}

function navigationState() {
  if (!kimiView || kimiView.webContents.isDestroyed()) {
    return {
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      title: 'Kimi',
      url: ''
    }
  }
  const history = kimiView.webContents.navigationHistory
  return {
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    isLoading: kimiView.webContents.isLoading(),
    title: kimiView.webContents.getTitle() || 'Kimi',
    url: kimiView.webContents.getURL()
  }
}

async function detectKimiProjectDirectory() {
  return (await detectKimiWorkspaceContext())?.projectDirectory || null
}

async function detectKimiWorkspaceContext() {
  if (!kimiView || kimiView.webContents.isDestroyed()) return null
  try {
    const context = await kimiView.webContents.executeJavaScript(`
      (() => {
        const results = []
        const sessionIds = []
        const pathPattern = /[A-Za-z]:[\\\\/][^<>"|?*\\r\\n]+/g
        const sessionPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig
        const collectSessionIds = value => {
          if (typeof value !== 'string') return
          for (const match of value.match(sessionPattern) || []) {
            if (!sessionIds.includes(match)) sessionIds.push(match)
          }
        }
        const collect = (value, score) => {
          if (typeof value !== 'string') return
          collectSessionIds(value)
          for (const match of value.match(pathPattern) || []) {
            results.push({
              path: match.replace(/[\\s,;:)}\\]]+$/, ''),
              score
            })
          }
        }
        for (const node of document.querySelectorAll(
          '[aria-current="true"], [aria-selected="true"], [data-state="active"], .active'
        )) {
          collect(node.textContent, 100)
          for (const attribute of node.attributes || []) collect(attribute.value, 110)
        }
        for (const node of document.querySelectorAll('[data-path], [data-cwd], [data-workspace]')) {
          for (const attribute of node.attributes || []) collect(attribute.value, 90)
        }
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index)
          const score = /cwd|project|workspace|directory|path/i.test(key) ? 80 : 40
          collect(localStorage.getItem(key), score)
        }
        for (let index = 0; index < sessionStorage.length; index += 1) {
          const key = sessionStorage.key(index)
          const score = /cwd|project|workspace|directory|path/i.test(key) ? 75 : 35
          collect(sessionStorage.getItem(key), score)
        }
        collectSessionIds(location.href)
        return {
          sessionIds,
          paths: results.sort((left, right) => right.score - left.score)
        }
      })()
    `, true)

    for (const sessionId of context.sessionIds) {
      const response = await net.fetch(
        `${localKimiService.url}api/sessions/${encodeURIComponent(sessionId)}`
      )
      if (!response.ok) continue
      const sessionInfo = await response.json()
      const workDirectory = await existingDirectory(sessionInfo?.work_dir)
      if (workDirectory) return { projectDirectory: workDirectory, sessionId }
    }

  } catch (error) {
    console.warn('Unable to detect the current Kimi project directory:', error)
  }
  return null
}

async function existingDirectory(value) {
  if (!value || typeof value !== 'string') return null
  try {
    const stat = await fs.stat(value)
    if (stat.isDirectory()) return path.normalize(value)
    if (stat.isFile()) return path.dirname(path.normalize(value))
  } catch {
    // Candidate can be stale, truncated, or only visible text.
  }
  return null
}

function broadcastQuotaState(state) {
  if (mainWindow && !mainWindow.isDestroyed() && shellView) {
    shellView.webContents.send('quota:state', state)
  }
  if (quotaView && !quotaView.webContents.isDestroyed()) {
    quotaView.webContents.send('quota:state', state)
  }
}

function isAllowedKimiCodeUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'app:' && demoMode) return true
    if (!localKimiService?.url) return false
    return url.origin === new URL(localKimiService.url).origin
  } catch {
    return false
  }
}

async function connectLocalKimiView() {
  if (!kimiView || kimiView.webContents.isDestroyed()) return
  await kimiView.webContents.loadURL('app://shell/service-loading.html')
  try {
    const url = await localKimiService.start()
    if (!kimiView || kimiView.webContents.isDestroyed()) return
    await kimiView.webContents.loadURL(url)
  } catch (error) {
    console.error(error)
    if (!kimiView || kimiView.webContents.isDestroyed()) return
    await kimiView.webContents.loadURL('app://shell/service-error.html')
  }
}

function openKimiLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show()
    loginWindow.focus()
    return loginPromise
  }

  loginWindow = new BrowserWindow({
    width: 1080,
    height: 800,
    minWidth: 900,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: '登录 Kimi 以同步额度',
    webPreferences: {
      partition: SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })

  const sanitizedUserAgent = loginWindow.webContents
    .getUserAgent()
    .replace(/\sElectron\/\S+/i, '')
  loginWindow.webContents.setUserAgent(sanitizedUserAgent)
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedKimiLoginUrl(url)) {
      loginWindow.webContents.loadURL(url)
    } else if (isSafeExternalUrl(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedKimiLoginUrl(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  })

  loginPromise = new Promise((resolve, reject) => {
    let settled = false
    let checking = false
    const finish = error => {
      if (settled) return
      settled = true
      clearInterval(timer)
      const window = loginWindow
      loginWindow = null
      loginPromise = null
      if (error) {
        reject(error)
      } else {
        resolve()
        if (window && !window.isDestroyed()) window.close()
      }
    }

    const checkLogin = async () => {
      if (checking || !loginWindow || loginWindow.isDestroyed()) return
      checking = true
      try {
        const result = await loginWindow.webContents.executeJavaScript(
          QUOTA_EXTRACTION_SCRIPT,
          true
        )
        if (result?.ready) finish()
      } catch {
        // Navigation can invalidate JavaScript execution; the next poll retries.
      } finally {
        checking = false
      }
    }

    const timer = setInterval(checkLogin, 800)
    loginWindow.on('closed', () => {
      if (!settled) {
        finish(new Error('已取消 Kimi 网页登录，额度未同步。'))
      }
    })
    loginWindow.once('ready-to-show', () => {
      loginWindow.show()
      loginWindow.focus()
    })
    loginWindow.loadURL(QUOTA_URL).catch(finish)
  })

  return loginPromise
}

function isSafeExternalUrl(value) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isAllowedKimiLoginUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && (url.hostname === 'kimi.com' || url.hostname.endsWith('.kimi.com'))
  } catch {
    return false
  }
}

async function readWindowState() {
  try {
    const value = JSON.parse(
      await fs.readFile(path.join(app.getPath('userData'), 'window-state.json'), 'utf8')
    )
    if (
      Number.isFinite(value.width)
      && Number.isFinite(value.height)
      && value.width >= 960
      && value.height >= 640
    ) {
      return value
    }
  } catch {
    return null
  }
  return null
}

async function saveWindowState() {
  if (!mainWindow) return
  const bounds = mainWindow.isMaximized()
    ? mainWindow.getNormalBounds()
    : mainWindow.getBounds()
  const state = {
    ...bounds,
    isMaximized: mainWindow.isMaximized()
  }
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(
    path.join(app.getPath('userData'), 'window-state.json'),
    JSON.stringify(state, null, 2)
  )
}

function argumentValue(prefix) {
  const argument = process.argv.find(value => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length).replace(/^"|"$/g, '') : null
}

async function runSelfTestMode(outputPath) {
  try {
    const result = await runQuotaFixtureSelfTest()
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2))
  } catch (error) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, JSON.stringify({
      ready: false,
      error: error instanceof Error ? error.stack : String(error)
    }, null, 2))
  }
}
