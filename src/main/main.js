import {
  app,
  BaseWindow,
  BrowserWindow,
  clipboard,
  dialog,
  WebContentsView,
  ipcMain,
  nativeImage,
  net,
  protocol,
  screen,
  session,
  shell
} from 'electron'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promises as fs, statSync } from 'node:fs'
import { QuotaService } from './quota-service.js'
import { runQuotaFixtureSelfTest } from './quota-worker.js'
import { QUOTA_EXTRACTION_SCRIPT } from './quota-extract.js'
import { loadQuotaPage } from './quota-navigation.js'
import { LocalKimiService } from './local-kimi-service.js'
import { parseKimiSessionId } from './local-kimi-runtime.js'
import { CloudCliService } from './cloud-cli-service.js'
import {
  detectCloudCliContext,
  extractCloudCliSessionContext,
  parseCloudCliSessionId
} from './cloudcli-context.js'
import { SettingsService, hasEngineConfigChanged } from './settings-service.js'
import { WorkbenchConfigService, resolveStartupEngine } from './workbench-config.js'
import {
  addSkillToLibrary,
  loadSkillsState,
  mergeSkillApps,
  removeSkill,
  restoreSkill,
  syncSkillToEngines
} from './skills-service.js'
import { copyPathsToWindowsClipboard } from './windows-file-clipboard.js'
import { requireSender, normalizeForkRequest } from './ipc-validators.js'
import { createKimiCodeUrlGuard } from './url-trust.js'
import { createGracefulShutdownHandler } from './graceful-shutdown.js'
import { createBackgroundContextSync } from './viewer-context-sync.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { startServer: startViewerServer } = require('../viewer/server.cjs')
const rendererRoot = path.resolve(__dirname, '../renderer')
const TITLEBAR_HEIGHT = 44
const POPUP_WIDTH = 382
const WINDOW_CONTROLS_WIDTH = 142
const SESSION_PARTITION = 'persist:kimi'

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
let cloudCliView = null
let viewerView = null
let settingsView = null
let quotaView = null
let viewerServer = null
let activeTab = 'kimi'
let quotaVisible = false
let quotaPreferredHeight = 620
let quotaService = null
let localKimiService = null
let cloudCliService = null
let settingsService = null
let workbenchConfigService = null
let activeEngine = 'kimi'
let viewerContextSync = null
let viewerContextLogPath = null
let lastViewerContextLog = { signature: '', timestamp: 0 }
let loginWindow = null
let loginPromise = null
let demoMode = false

const isTrustedKimiCodeUrl = createKimiCodeUrlGuard(() => ({
  viewerPort: viewerServer?.port,
  kimiUrl: localKimiService?.url,
  demoMode
}))

function isTrustedCloudCliUrl(url) {
  try {
    const target = new URL(url)
    const cloudUrl = cloudCliService?.url
    if (!cloudUrl) return false
    const allowed = new URL(cloudUrl)
    return target.origin === allowed.origin
  } catch {
    return false
  }
}

app.setName('KCC Workbench')
const isDemoLaunch = process.argv.includes('--demo')
if (isDemoLaunch) {
  const demoProfile = (argumentValue('--demo-profile=') || 'default')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 40)
  app.setPath(
    'userData',
    path.join(app.getPath('temp'), `KimiCodeWorkbenchDemo-${demoProfile || 'default'}`)
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

const LEGACY_USER_DATA_NAME = 'Kimi Desktop'

async function migrateLegacyUserData() {
  if (isDemoLaunch || selfTestRequested) return  // demo 用临时目录、self-test 为诊断模式, 均不迁移
  try {
    const currentDir = app.getPath('userData')
    let existing = []
    try { existing = await fs.readdir(currentDir) } catch { /* 新目录尚未创建 */ }
    if (existing.length > 0) return  // 新目录已有数据, 不覆盖
    const legacyDir = path.join(app.getPath('appData'), LEGACY_USER_DATA_NAME)
    try { await fs.access(legacyDir) } catch { return }  // 无旧目录可迁移
    await fs.cp(legacyDir, currentDir, { recursive: true, force: true })
    console.log(`[migrate] 已从 ${legacyDir} 迁移历史用户数据到 ${currentDir}`)
  } catch (error) {
    console.error(`[migrate] 迁移失败, 以空状态启动: ${error.message}`)
  }
}

app.whenReady().then(async () => {
  await migrateLegacyUserData()
  await registerAppProtocol()

  const selfTestPath = argumentValue('--self-test-quota=')
  if (selfTestPath) {
    await runSelfTestMode(selfTestPath)
    app.quit()
    return
  }

  demoMode = process.argv.includes('--demo')
  viewerContextLogPath = path.join(app.getPath('userData'), 'viewer-context.log')
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
    workbenchConfigService = new WorkbenchConfigService({
      exeDir: path.dirname(app.getPath('exe')),
      fallbackDir: app.getPath('userData'),
      forceFallback: demoMode || settingsSandboxed
    })
    await workbenchConfigService.initialize()
    activeEngine = resolveStartupEngine(await workbenchConfigService.get())
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
    logPath: path.join(app.getPath('userData'), 'kimi-web.log'),
    portPath: path.join(app.getPath('userData'), 'kimi-web-port.json'),
    getPermissionMode: async () => (await settingsService.getState()).config.default_permission_mode
  })
  cloudCliService = new CloudCliService({
    logPath: path.join(app.getPath('userData'), 'cloudcli-web.log')
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
  dialog.showErrorBox('KCC Workbench 无法启动', detail)
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

const handleBeforeQuit = createGracefulShutdownHandler({
  quit: () => app.quit(),
  async shutdown() {
    quotaService?.dispose()
    await localKimiService?.stop()
    await cloudCliService?.stop()
    const server = viewerServer
    viewerServer = null
    await server?.close()
  },
  onError: error => console.error('Graceful shutdown failed:', error)
})
app.on('before-quit', handleBeforeQuit)

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
    webContents => isTrustedKimiCodeUrl(webContents.getURL())
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
    title: 'KCC Workbench',
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
  viewerContextSync = createBackgroundContextSync({
    sync: syncViewerConversationContext,
    pollMs: 3000,
    onError: error => console.warn('Unable to sync the current Kimi conversation:', error)
  })
  createKimiView()
  createCloudCliView()
  if (activeEngine === 'cloudcli') {
    mainWindow.contentView.removeChildView(kimiView)
    mainWindow.contentView.addChildView(cloudCliView)
  }
  createViewerView()
  viewerContextSync.start()
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
    viewerContextSync?.stop()
    viewerContextSync = null
    quotaVisible = false
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.close()
    }
    for (const view of [shellView, kimiView, cloudCliView, viewerView, settingsView, quotaView]) {
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    }
    shellView = null
    quotaView = null
    kimiView = null
    cloudCliView = null
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
  registerEngineShortcut(shellView)
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
  registerEngineShortcut(kimiView)
  mainWindow.contentView.addChildView(kimiView)

  kimiView.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedKimiCodeUrl(url)) {
      kimiView.webContents.loadURL(url)
    } else if (isSafeExternalUrl(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  kimiView.webContents.on('will-navigate', (event, url) => {
    if (isTrustedKimiCodeUrl(url)) return
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
    kimiView.webContents.on(eventName, () => {
      sendNavigationState()
      if (['did-navigate', 'did-navigate-in-page', 'did-stop-loading', 'page-title-updated'].includes(eventName)) {
        viewerContextSync?.request()
      }
    })
  }
  kimiView.webContents.on('focus', () => {
    closeQuotaPopup()
    viewerContextSync?.request(0)
  })

  if (demoMode) {
    kimiView.webContents.loadURL('app://shell/demo-kimi.html')
  } else {
    connectLocalKimiView()
  }
}

function createCloudCliView() {
  cloudCliView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  cloudCliView.setBackgroundColor('#ffffff')
  registerEngineShortcut(cloudCliView)

  cloudCliView.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedCloudCliUrl(url)) {
      cloudCliView.webContents.loadURL(url)
    } else if (isSafeExternalUrl(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  cloudCliView.webContents.on('will-navigate', (event, url) => {
    if (isTrustedCloudCliUrl(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  })
  for (const eventName of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading']) {
    cloudCliView.webContents.on(eventName, () => {
      if (activeEngine === 'cloudcli') sendNavigationState()
      viewerContextSync?.request()
    })
  }
  cloudCliView.webContents.on('focus', () => {
    closeQuotaPopup()
    viewerContextSync?.request(0)
  })
  connectCloudCliView()
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
  registerEngineShortcut(viewerView)
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
  registerEngineShortcut(settingsView)
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
  registerEngineShortcut(quotaView)
  quotaView.webContents.loadURL('app://shell/quota.html')
}

function layoutViews() {
  if (!mainWindow || !shellView || !kimiView || !cloudCliView || !viewerView || !settingsView) return
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
  cloudCliView.setBounds(contentBounds)
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
  if (!mainWindow || !shellView || !kimiView || !cloudCliView || !viewerView || !settingsView) return
  if (!['kimi', 'viewer', 'settings'].includes(nextTab) || nextTab === activeTab) return
  closeQuotaPopup()

  const views = {
    kimi: activeEngineView(),
    viewer: viewerView,
    settings: settingsView
  }
  const previousView = views[activeTab]
  const nextView = views[nextTab]
  mainWindow.contentView.removeChildView(previousView)
  mainWindow.contentView.addChildView(nextView)
  activeTab = nextTab

  if (activeTab === 'viewer') {
    await syncViewerConversationContext()
  }
  if (activeTab === 'settings') {
    settingsService.setProjectDirectory(await detectKimiProjectDirectory())
  }

  layoutViews()
  nextView.webContents.focus()
  shellView.webContents.send('shell:tab-changed', {
    activeTab,
    activeEngine,
    viewerRoot: viewerServer.root
  })
}

async function switchEngine(nextEngine) {
  if (!['kimi', 'cloudcli'].includes(nextEngine) || nextEngine === activeEngine) {
    return { engine: activeEngine }
  }
  const previousView = activeEngineView()
  closeQuotaPopup()
  activeEngine = nextEngine
  const nextView = activeEngineView()
  if (activeTab === 'kimi' && mainWindow) {
    mainWindow.contentView.removeChildView(previousView)
    mainWindow.contentView.addChildView(nextView)
    layoutViews()
    nextView.webContents.focus()
  }
  await persistLastEngine()
  sendNavigationState()
  shellView?.webContents.send('engine:changed', { engine: activeEngine })
  await syncViewerConversationContext()
  return { engine: activeEngine }
}

async function persistLastEngine() {
  try {
    const config = await workbenchConfigService.get()
    if (config.rememberEngine) {
      await workbenchConfigService.save({ lastEngine: activeEngine })
    }
  } catch (error) {
    console.error('Unable to persist last engine:', error)
  }
}

function toggleEngine() {
  return switchEngine(activeEngine === 'kimi' ? 'cloudcli' : 'kimi')
}

function activeEngineView() {
  return activeEngine === 'cloudcli' ? cloudCliView : kimiView
}

function registerEngineShortcut(view) {
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat || !input.alt || input.control || input.meta) return
    if (String(input.key).toLowerCase() !== 'q') return
    event.preventDefault()
    toggleEngine().catch(error => console.error('Unable to switch engine:', error))
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
  ipcMain.removeHandler('kimi:restart-web')
  ipcMain.removeHandler('engine:switch')
  ipcMain.removeHandler('engine:toggle')
  ipcMain.removeHandler('engine:get-state')
  ipcMain.removeHandler('quota:get-state')
  ipcMain.removeHandler('quota:refresh')
  ipcMain.removeHandler('quota:close')
  ipcMain.removeHandler('quota:set-preferred-height')
  ipcMain.removeHandler('viewer:select-directory')
  ipcMain.removeHandler('viewer:set-root')
  ipcMain.removeHandler('viewer:get-workbench-mode')
  ipcMain.removeHandler('viewer:fork-checkpoint')
  ipcMain.removeHandler('viewer:copy-files')
  ipcMain.removeHandler('viewer:copy-png')
  ipcMain.removeHandler('settings:get-state')
  ipcMain.removeHandler('settings:save')
  ipcMain.removeHandler('settings:select-directory')
  ipcMain.removeHandler('settings:skills-add')
  ipcMain.removeHandler('settings:skills-remove')
  ipcMain.removeHandler('settings:skills-restore')
  ipcMain.removeHandler('settings:skills-sync')

  ipcMain.handle('shell:get-state', event => {
    requireSender(event, shellView.webContents)
    return {
      quota: quotaService.getState(),
      navigation: navigationState(),
      activeTab,
      activeEngine,
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
    const history = activeEngineView().webContents.navigationHistory
    if (history.canGoBack()) history.goBack()
  })
  ipcMain.handle('nav:forward', event => {
    requireSender(event, shellView.webContents)
    const history = activeEngineView().webContents.navigationHistory
    if (history.canGoForward()) history.goForward()
  })
  ipcMain.handle('nav:reload', event => {
    requireSender(event, shellView.webContents)
    const engineView = activeEngineView()
    if (engineView.webContents.getURL().startsWith('app://shell/service-')) {
      if (activeEngine === 'kimi') connectLocalKimiView()
      else connectCloudCliView()
    } else {
      engineView.webContents.reload()
    }
  })
  ipcMain.handle('kimi:restart-web', async event => {
    requireSender(event, shellView.webContents)
    await localKimiService.stop()
    await connectLocalKimiView()
  })
  ipcMain.handle('engine:switch', async (event, nextEngine) => {
    requireSender(event, shellView.webContents)
    return switchEngine(nextEngine)
  })
  ipcMain.handle('engine:toggle', async event => {
    requireSender(event, shellView.webContents)
    return toggleEngine()
  })
  ipcMain.handle('engine:get-state', event => {
    requireSender(event, shellView.webContents)
    return { engine: activeEngine }
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
  ipcMain.handle('viewer:get-workbench-mode', async event => {
    requireSender(event, viewerView.webContents)
    const config = await workbenchConfigService.get()
    return config.viewerMode || 'auto'
  })
  ipcMain.handle('viewer:set-root', async (event, nextRoot) => {
    requireSender(event, viewerView.webContents)
    if (typeof nextRoot !== 'string' || nextRoot.length > 4096) {
      throw new Error('项目目录无效')
    }
    if (!await viewerServer.setRoot(nextRoot.trim())) {
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
  ipcMain.handle('viewer:copy-png', async (event, pngBytes) => {
    requireSender(event, viewerView.webContents)
    if (!pngBytes || !(pngBytes instanceof Uint8Array) || pngBytes.length === 0 || pngBytes.length > 50 * 1024 * 1024) {
      throw new Error('无效的图片数据')
    }
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(pngBytes)))
    return true
  })
  ipcMain.handle('viewer:trash-item', async (event, paths) => {
    requireSender(event, viewerView.webContents)
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('没有可删除的文件')
    }
    const canonicalRoot = await fs.realpath(viewerServer.root)
    const safePaths = []
    for (const value of paths) {
      const canonicalPath = await fs.realpath(path.resolve(String(value)))
      if (canonicalPath === canonicalRoot) {
        throw new Error('不能删除项目根目录')
      }
      if (!canonicalPath.startsWith(`${canonicalRoot}${path.sep}`)) {
        throw new Error('文件不在当前项目目录中')
      }
      safePaths.push(canonicalPath)
    }
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '放入回收站',
      message: `确认将 ${safePaths.length} 个文件放入回收站？`,
      detail: safePaths.map(p => path.basename(p)).join('\n'),
      buttons: ['取消', '放入回收站'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (confirmation.response !== 1) throw new Error('已取消放入回收站')
    for (const filePath of safePaths) {
      await shell.trashItem(filePath)
    }
    return true
  })
  ipcMain.handle('settings:get-state', async event => {
    requireSender(event, settingsView.webContents)
    settingsService.setProjectDirectory(await detectKimiProjectDirectory())
    const workbenchInfo = await workbenchConfigService.get()
    const libraryPath = resolveSkillsLibraryPath(workbenchInfo)
    await ensureKimiSkillPointer(libraryPath)
    const kimiState = await settingsService.getState()
    const skills = await loadSkillsState({
      libraryPath,
      homePath: app.getPath('home'),
      override: workbenchInfo.skills?.targets,
      syncMethods: workbenchInfo.skills?.projection,
      managedConfig: workbenchInfo.skills?.managed
    })
    return {
      ...kimiState,
      skills,
      workbench: {
        config: await workbenchConfigService.get(),
        ...workbenchConfigService.describe()
      }
    }
  })
  ipcMain.handle('settings:save', async (event, payload) => {
    requireSender(event, settingsView.webContents)
    const previousConfig = (await settingsService.getState()).config
    const nextState = await settingsService.save(payload || {})
    if (hasEngineConfigChanged(previousConfig, nextState.config)) {
      await localKimiService.stop()
      await connectLocalKimiView()
    }
    const workbenchInfo = await workbenchConfigService.save(payload?.workbench || {})
    return {
      ...nextState,
      workbench: {
        config: await workbenchConfigService.get(),
        ...workbenchInfo
      }
    }
  })
  ipcMain.handle('settings:skills-add', async (event, payload) => {
    requireSender(event, settingsView.webContents)
    if (!payload || typeof payload !== 'object' || typeof payload.sourceDir !== 'string') {
      throw new Error('Skill 源目录无效')
    }
    const workbenchInfo = await workbenchConfigService.get()
    const libraryPath = resolveSkillsLibraryPath(workbenchInfo)
    await ensureKimiSkillPointer(libraryPath)
    const added = await addSkillToLibrary({ libraryPath, sourceDir: payload.sourceDir })
    const apps = defaultSkillApps(payload.apps)
    const syncMethods = workbenchInfo.skills?.projection || {}
    const results = await syncSkillToEngines({
      libraryPath,
      skillName: added.name,
      apps,
      homePath: app.getPath('home'),
      override: workbenchInfo.skills?.targets,
      syncMethods
    })
    const workbenchNext = await workbenchConfigService.save({
      skills: {
        ...workbenchInfo.skills,
        managed: { ...(workbenchInfo.skills?.managed || {}), [added.name]: { apps } }
      }
    })
    return {
      added,
      results,
      workbench: { config: await workbenchConfigService.get(), ...workbenchNext }
    }
  })
  ipcMain.handle('settings:skills-remove', async (event, payload) => {
    requireSender(event, settingsView.webContents)
    if (!payload || typeof payload !== 'object' || typeof payload.name !== 'string') {
      throw new Error('Skill 名称无效')
    }
    const workbenchInfo = await workbenchConfigService.get()
    const libraryPath = resolveSkillsLibraryPath(workbenchInfo)
    const managed = workbenchInfo.skills?.managed || {}
    const apps = managed[payload.name]?.apps || {}
    const backupDir = path.join(workbenchConfigService.storageDir, 'skill-backups')
    const removed = await removeSkill({
      libraryPath,
      skillName: payload.name,
      homePath: app.getPath('home'),
      override: workbenchInfo.skills?.targets,
      backupDir,
      apps
    })
    const nextManaged = { ...managed }
    delete nextManaged[payload.name]
    const workbenchNext = await workbenchConfigService.save({
      skills: { ...workbenchInfo.skills, managed: nextManaged }
    })
    return { removed, workbench: { config: await workbenchConfigService.get(), ...workbenchNext } }
  })
  ipcMain.handle('settings:skills-restore', async (event, payload) => {
    requireSender(event, settingsView.webContents)
    if (!payload || typeof payload !== 'object'
      || typeof payload.name !== 'string'
      || typeof payload.backupPath !== 'string') {
      throw new Error('Skill 恢复参数无效')
    }
    const workbenchInfo = await workbenchConfigService.get()
    const libraryPath = resolveSkillsLibraryPath(workbenchInfo)
    const backupDir = path.join(workbenchConfigService.storageDir, 'skill-backups')
    const restored = await restoreSkill({
      libraryPath,
      skillName: payload.name,
      backupDir,
      backupPath: payload.backupPath
    })
    const apps = defaultSkillApps(payload.apps)
    await ensureKimiSkillPointer(libraryPath)
    const results = await syncSkillToEngines({
      libraryPath,
      skillName: restored.name,
      apps,
      homePath: app.getPath('home'),
      override: workbenchInfo.skills?.targets,
      syncMethods: workbenchInfo.skills?.projection
    })
    const workbenchNext = await workbenchConfigService.save({
      skills: {
        ...workbenchInfo.skills,
        managed: {
          ...(workbenchInfo.skills?.managed || {}),
          [restored.name]: { apps }
        }
      }
    })
    return {
      restored: { ...restored, apps },
      results,
      workbench: { config: await workbenchConfigService.get(), ...workbenchNext }
    }
  })
  ipcMain.handle('settings:skills-sync', async (event, payload) => {
    requireSender(event, settingsView.webContents)
    const workbenchInfo = await workbenchConfigService.get()
    const libraryPath = resolveSkillsLibraryPath(workbenchInfo)
    await ensureKimiSkillPointer(libraryPath)
    const managed = workbenchInfo.skills?.managed || {}
    const targetApps = payload?.apps || {}
    const results = {}
    for (const [name, apps] of Object.entries(managed)) {
      const effectiveApps = mergeSkillApps(apps, targetApps[name])
      results[name] = await syncSkillToEngines({
        libraryPath,
        skillName: name,
        apps: effectiveApps,
        homePath: app.getPath('home'),
        override: workbenchInfo.skills?.targets,
        syncMethods: workbenchInfo.skills?.projection
      })
    }
    const workbenchNext = await workbenchConfigService.save({
      skills: {
        ...workbenchInfo.skills,
        managed: {
          ...managed,
          ...Object.fromEntries(Object.entries(targetApps).map(([name, apps]) => [name, { apps: normalizeSkillApps(apps) }]))
        }
      }
    })
    return { results, workbench: { config: await workbenchConfigService.get(), ...workbenchNext } }
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

function sendNavigationState() {
  if (!mainWindow || mainWindow.isDestroyed() || !shellView) return
  shellView.webContents.send('navigation:state', navigationState())
}

function navigationState() {
  const engineView = activeEngineView()
  if (!engineView || engineView.webContents.isDestroyed()) {
    return {
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      title: 'Kimi',
      url: ''
    }
  }
  const history = engineView.webContents.navigationHistory
  return {
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    isLoading: engineView.webContents.isLoading(),
    title: engineView.webContents.getTitle() || (activeEngine === 'cloudcli' ? 'CloudCLI' : 'Kimi'),
    url: engineView.webContents.getURL()
  }
}

async function detectKimiProjectDirectory() {
  return (await detectKimiWorkspaceContext()).context?.projectDirectory || null
}

async function syncViewerConversationContext() {
  if (!viewerServer) return false
  const detection = activeEngine === 'cloudcli'
    ? await detectCloudCliWorkspaceContext()
    : await detectKimiWorkspaceContext()
  const context = detection.context
  if (!context?.projectDirectory) {
    await logViewerContext('context-miss', {
      engine: activeEngine,
      cloudCliUrl: activeEngine === 'cloudcli' ? cloudCliView?.webContents.getURL() : undefined,
      routeSessionId: detection.routeSessionId,
      apiStatus: detection.apiStatus,
      apiError: detection.apiError,
      fallback: detection.fallback
    })
    return false
  }
  const prefix = activeEngine === 'cloudcli' ? 'cloudcli' : 'kimi'
  const label = activeEngine === 'cloudcli' ? '当前 CloudCLI 会话' : '当前 Kimi 对话'
  const previousRoot = viewerServer.root
  const extraRoots = normalizeExtraRoots(context.touchedPaths, context.projectDirectory)
  await viewerServer.setConversationContext({
    id: context.sessionId ? `${prefix}:${context.sessionId}` : `workspace:${context.projectDirectory.toLowerCase()}`,
    label: context.sessionId ? label : '当前工作区',
    root: context.projectDirectory,
    extraRoots
  })
  await logViewerContext('context-applied', {
    engine: activeEngine,
    source: context.source || (activeEngine === 'cloudcli' ? 'jsonl-activity' : 'kimi-api'),
    provider: context.provider,
    sessionId: context.sessionId,
    routeSessionId: detection.routeSessionId,
    apiStatus: detection.apiStatus,
    apiError: detection.apiError,
    fallback: detection.fallback,
    projectDirectory: context.projectDirectory,
    extraRootCount: extraRoots.length,
    extraRoots,
    previousRoot,
    viewerRoot: viewerServer.root
  })
  return true
}

async function detectCloudCliWorkspaceContext() {
  const cloudCliUrl = cloudCliView?.webContents.getURL() || ''
  const routeSessionId = parseCloudCliSessionId(cloudCliUrl)
  let apiStatus = null
  let apiError = null

  if (routeSessionId && cloudCliView && !cloudCliView.webContents.isDestroyed()) {
    try {
      const result = await cloudCliView.webContents.executeJavaScript(`
        (async () => {
          const sessionId = ${JSON.stringify(routeSessionId)}
          const token = localStorage.getItem('auth-token')
          const response = await fetch('/api/providers/sessions/' + encodeURIComponent(sessionId), {
            headers: token ? { Authorization: 'Bearer ' + token } : {}
          })
          const text = await response.text()
          let payload = null
          try { payload = JSON.parse(text) } catch {}
          return { ok: response.ok, status: response.status, payload }
        })()
      `, true)
      apiStatus = result?.status ?? null
      const routeContext = result?.ok
        ? extractCloudCliSessionContext(result.payload, routeSessionId)
        : null
      const projectDirectory = await existingDirectory(routeContext?.projectDirectory)
      if (routeContext && projectDirectory) {
        return {
          context: { ...routeContext, projectDirectory },
          routeSessionId,
          apiStatus,
          fallback: false
        }
      }
      if (result?.ok && routeContext && !projectDirectory) apiError = 'project-directory-missing'
      else if (!result?.ok) apiError = 'session-api-request-failed'
      else apiError = 'session-api-payload-missing-project'
    } catch (error) {
      apiError = error instanceof Error ? error.message : String(error)
    }
  }

  const fallbackContext = await detectCloudCliContext()
  return {
    context: fallbackContext ? { ...fallbackContext, source: 'jsonl-activity' } : null,
    routeSessionId,
    apiStatus,
    apiError,
    fallback: true
  }
}

async function logViewerContext(event, details) {
  if (!viewerContextLogPath) return
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...Object.fromEntries(Object.entries(details || {}).filter(([, value]) => value !== undefined))
  }
  const signature = JSON.stringify({ event, ...details })
  const now = Date.now()
  if (signature === lastViewerContextLog.signature && now - lastViewerContextLog.timestamp < 60_000) return
  lastViewerContextLog = { signature, timestamp: now }
  try {
    await fs.mkdir(path.dirname(viewerContextLogPath), { recursive: true })
    await fs.appendFile(viewerContextLogPath, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (error) {
    console.warn('Unable to write Viewer context log:', error)
  }
}

async function detectKimiWorkspaceContext() {
  const routeSessionId = kimiView && !kimiView.webContents.isDestroyed()
    ? parseKimiSessionId(kimiView.webContents.getURL()) || null
    : null
  if (!kimiView || kimiView.webContents.isDestroyed()) {
    return { context: null, routeSessionId, fallback: false }
  }
  try {
    const context = await kimiView.webContents.executeJavaScript(`
      (() => {
        const results = []
        const sessionIds = []
        const pathPattern = /[A-Za-z]:[\\\\/][^<>"|?*\\r\\n]+/g
        const legacySessionPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig
        const kimiCodeSessionPattern = /ses_[A-Za-z0-9_-]+/g
        const addSessionId = value => {
          if (typeof value === 'string' && value && !sessionIds.includes(value)) sessionIds.push(value)
        }
        const collectSessionIds = value => {
          if (typeof value !== 'string') return
          for (const match of value.match(kimiCodeSessionPattern) || []) addSessionId(match)
          for (const match of value.match(legacySessionPattern) || []) {
            const offset = value.indexOf(match)
            if (offset >= 4 && value.slice(offset - 4, offset).toLowerCase() === 'ses_') continue
            addSessionId(match)
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
        collectSessionIds(location.pathname)
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

    const sessionIds = [routeSessionId, ...context.sessionIds].filter(
      (sessionId, index, all) => sessionId && all.indexOf(sessionId) === index
    )
    for (const sessionId of sessionIds) {
      const sessionInfo = await fetchKimiSession(sessionId)
      const workDirectory = await existingDirectory(
        sessionInfo?.work_dir
        || sessionInfo?.metadata?.cwd
        || sessionInfo?.cwd
        || sessionInfo?.workspace?.cwd
      )
      if (workDirectory) {
        return {
          context: { projectDirectory: workDirectory, sessionId },
          routeSessionId,
          fallback: false
        }
      }
    }

  } catch (error) {
    console.warn('Unable to detect the current Kimi project directory:', error)
    return {
      context: null,
      routeSessionId,
      apiError: error instanceof Error ? error.message : String(error),
      fallback: false
    }
  }
  return { context: null, routeSessionId, fallback: false }
}

async function fetchKimiSession(sessionId) {
  const encodedId = encodeURIComponent(sessionId)
  const candidates = sessionId.startsWith('ses_')
    ? [`${localKimiService.url}api/v1/sessions/${encodedId}`, `${localKimiService.url}api/sessions/${encodedId}`]
    : [`${localKimiService.url}api/sessions/${encodedId}`, `${localKimiService.url}api/v1/sessions/${encodedId}`]
  for (const url of candidates) {
    try {
      const response = await net.fetch(url, { headers: localKimiService.apiHeaders })
      if (!response.ok) continue
      const payload = await response.json()
      return payload?.data || payload
    } catch {
      // Try the compatible endpoint before reporting a context miss.
    }
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

function normalizeExtraRoots(touchedPaths, projectDirectory) {
  if (!Array.isArray(touchedPaths) || !projectDirectory) return []
  const seen = new Set()
  const roots = []
  for (const raw of touchedPaths) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const candidate = path.normalize(raw.trim())
    const probe = (() => {
      try {
        return statSync(candidate)
      } catch {
        return null
      }
    })()
    if (!probe) continue
    const root = probe.isFile() ? path.dirname(candidate) : candidate
    if (projectDirectory && (root === projectDirectory || isPathInside(root, projectDirectory))) {
      continue
    }
    const lower = root.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    roots.push(root)
    if (roots.length >= 20) break
  }
  return roots
}

function isPathInside(target, root) {
  const normalizedTarget = path.normalize(target)
  const normalizedRoot = path.normalize(root)
  return normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

function broadcastQuotaState(state) {
  if (mainWindow && !mainWindow.isDestroyed() && shellView) {
    shellView.webContents.send('quota:state', state)
  }
  if (quotaView && !quotaView.webContents.isDestroyed()) {
    quotaView.webContents.send('quota:state', state)
  }
}

async function connectLocalKimiView() {
  if (!kimiView || kimiView.webContents.isDestroyed()) return
  await kimiView.webContents.loadURL('app://shell/service-loading.html')
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const url = await localKimiService.start()
      if (!kimiView || kimiView.webContents.isDestroyed()) return
      await kimiView.webContents.loadURL(localKimiService.webUrl || url)
      viewerContextSync?.request(0)
      return
    } catch (error) {
      lastError = error
      console.error(`Unable to start Kimi Web (attempt ${attempt + 1}/2):`, error)
      if (attempt === 0) {
        await localKimiService.stop()
        await new Promise(resolve => setTimeout(resolve, 250))
        if (!kimiView || kimiView.webContents.isDestroyed()) return
      }
    }
  }
  if (!kimiView || kimiView.webContents.isDestroyed()) return
  console.error('Unable to start Kimi Web after retry:', lastError)
  await kimiView.webContents.loadURL('app://shell/service-error.html')
}

async function connectCloudCliView() {
  if (!cloudCliView || cloudCliView.webContents.isDestroyed()) return
  await cloudCliView.webContents.loadURL('app://shell/service-loading.html')
  try {
    const url = await cloudCliService.start()
    if (!cloudCliView || cloudCliView.webContents.isDestroyed()) return
    await cloudCliView.webContents.loadURL(url)
    viewerContextSync?.request(0)
  } catch (error) {
    console.error(error)
    if (!cloudCliView || cloudCliView.webContents.isDestroyed()) return
    const detail = error instanceof Error ? error.message : String(error)
    const errorUrl = new URL('app://shell/service-error-cloudcli.html')
    errorUrl.searchParams.set('detail', detail.slice(0, 1200))
    await cloudCliView.webContents.loadURL(errorUrl.toString())
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
    loadQuotaPage(loginWindow).catch(finish)
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
      if (!isWindowPositionVisible(value.x, value.y)) {
        delete value.x
        delete value.y
      }
      return value
    }
  } catch {
    return null
  }
  return null
}

function isWindowPositionVisible(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  return screen.getAllDisplays().some(display => {
    const bounds = display.bounds
    return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height
  })
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

function resolveSkillsLibraryPath(workbenchInfo) {
  return path.resolve(
    workbenchInfo?.skills?.library
    || path.join(workbenchConfigService.storageDir, 'skills')
  )
}

async function ensureKimiSkillPointer(libraryPath) {
  if (!settingsService) return false
  const before = await settingsService.getState()
  const current = Array.isArray(before.config?.extra_skill_dirs)
    ? before.config.extra_skill_dirs
    : []
  const normalizedLibrary = path.resolve(libraryPath)
  if (current.some(item => path.resolve(String(item)) === normalizedLibrary)) return false
  const next = [...current, normalizedLibrary]
  const after = await settingsService.save({ config: { extra_skill_dirs: next } })
  if (hasEngineConfigChanged(before.config, after.config)) {
    await localKimiService?.stop()
    if (kimiView && !kimiView.webContents.isDestroyed()) await connectLocalKimiView()
  }
  return true
}


function defaultSkillApps(apps) {
  if (apps && typeof apps === 'object') return normalizeSkillApps(apps)
  return { kimi: true, claude: true, codex: true }
}

function normalizeSkillApps(apps) {
  const result = { kimi: false, claude: false, codex: false }
  for (const key of ['kimi', 'claude', 'codex']) result[key] = Boolean(apps?.[key])
  if (!result.kimi && !result.claude && !result.codex) result.kimi = true
  return result
}
