import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'

/**
 * 主进程入口：只负责窗口生命周期与安全策略，业务逻辑都在 ipc.ts 后面的模块里。
 */

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'StockLens',
    backgroundColor: '#0a0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 无头环境自检：STOCKLENS_SMOKE=<png 路径> 时截图后退出，用于 CI 与打包后冒烟
  const smokeTarget = process.env['STOCKLENS_SMOKE']
  if (smokeTarget) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void (async () => {
          try {
            const image = await mainWindow?.webContents.capturePage()
            if (image) {
              await writeFile(smokeTarget, image.toPNG())
              console.log(`[smoke] 截图已保存：${smokeTarget}`)
            }
          } catch (err) {
            console.error('[smoke] 截图失败', err)
          } finally {
            app.exit(0)
          }
        })()
      }, Number(process.env['STOCKLENS_SMOKE_DELAY'] ?? 7000))
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 外部链接一律交给系统浏览器，应用内不允许导航到站外
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    registerIpc(() => mainWindow)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
