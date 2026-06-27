import { lazy, Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import AIChatWidget from './AIChatWidget'
import { cn } from '../../lib/cn'

const HotStreakTicker = lazy(() => import('./HotStreakTicker'))
const WeeklyLeaderboardTicker = lazy(() => import('./WeeklyLeaderboardTicker'))

const SIDEBAR_W = 236

function DeferredTickers() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const run = () => setReady(true)
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 1500 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(run, 300)
    return () => clearTimeout(id)
  }, [])

  if (!ready) return null

  return (
    <Suspense fallback={null}>
      <HotStreakTicker />
      <WeeklyLeaderboardTicker />
    </Suspense>
  )
}

export default function AppLayout() {
  const { pathname } = useLocation()
  const isMap = pathname === '/map'
  const isTeams = pathname === '/teams'

  return (
    <div className="h-screen overflow-hidden" style={{ background: 'var(--g-backdrop)' }}>
      <Sidebar />
      <div
        className="flex flex-col h-screen min-w-0 overflow-hidden"
        style={{ marginLeft: SIDEBAR_W, width: `calc(100vw - ${SIDEBAR_W}px)` }}
      >
        <DeferredTickers />
        <main
          className={cn(
            'flex-1 min-h-0 min-w-0 relative',
            isMap || isTeams ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-6 lg:px-7 lg:py-6',
          )}
        >
          <div className={cn('h-full min-h-0', (isMap || isTeams) && 'px-4 py-3 sm:px-5')}>
            <Outlet />
          </div>
        </main>
      </div>
      <AIChatWidget />
    </div>
  )
}
