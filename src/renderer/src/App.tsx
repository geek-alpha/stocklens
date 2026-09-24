import { useEffect } from 'react'
import AiPanel from './components/AiPanel'
import ChartPanel from './components/ChartPanel'
import LicenseDialog from './components/LicenseDialog'
import QuoteHeader from './components/QuoteHeader'
import SettingsDialog from './components/SettingsDialog'
import StatusBar from './components/StatusBar'
import Toolbar from './components/Toolbar'
import WatchList from './components/WatchList'
import { api } from './lib/api'
import { useAppStore } from './store/useAppStore'

export default function App() {
  const bootstrap = useAppStore((s) => s.bootstrap)
  const refreshQuotes = useAppStore((s) => s.refreshQuotes)
  const refreshIntervalMs = useAppStore((s) => s.settings?.refreshIntervalMs ?? 10_000)
  const applyAiChunk = useAppStore((s) => s.applyAiChunk)
  const toast = useAppStore((s) => s.toast)
  const setToast = useAppStore((s) => s.setToast)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const aiPanelOpen = useAppStore((s) => s.aiPanelOpen)
  const ready = useAppStore((s) => s.ready)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // AI 流式输出只在这里订阅一次，避免每个组件各自开一条监听
  useEffect(() => {
    const unsubscribe = api.onAiChunk(applyAiChunk)
    return unsubscribe
  }, [applyAiChunk])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshQuotes()
    }, Math.max(3000, refreshIntervalMs))
    return () => window.clearInterval(timer)
  }, [refreshQuotes, refreshIntervalMs])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast, setToast])

  return (
    <div className="flex h-full flex-col bg-surface-950 text-slate-200">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? <WatchList /> : null}
        <main className="flex min-w-0 flex-1 flex-col">
          <QuoteHeader />
          <ChartPanel />
        </main>
        {aiPanelOpen ? <AiPanel /> : null}
      </div>
      <StatusBar />

      {!ready ? (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center bg-surface-950/80">
          <div className="text-sm text-slate-400">正在载入行情…</div>
        </div>
      ) : null}

      {toast ? (
        <div
          className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-lg ${
            toast.kind === 'error'
              ? 'border-bear/50 bg-bear/15 text-rose-200'
              : 'border-accent/50 bg-accent/15 text-sky-200'
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <SettingsDialog />
      <LicenseDialog />
    </div>
  )
}
