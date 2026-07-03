import { lazy, Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import AIChatWidget from './AIChatWidget'
import AppBrand from './AppBrand'
import { cn } from '../../lib/cn'

const HotStreakTicker = lazy(() => import('./HotStreakTicker'))
const WeeklyLeaderboardTicker = lazy(() => import('./WeeklyLeaderboardTicker'))

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
  const [navOpen, setNavOpen] = useState(false)
  // The drawer closes on nav because each Sidebar NavLink calls onClose.

  return (
    <div className="h-screen overflow-hidden" style={{ background: 'var(--g-backdrop)' }}>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Mobile backdrop */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex flex-col h-screen w-full min-w-0 overflow-hidden lg:ml-[236px] lg:w-[calc(100vw-236px)]">
        {/* Mobile top bar with hamburger */}
        <header
          className="lg:hidden flex items-center gap-3 px-4 h-14 shrink-0 border-b"
          style={{ borderColor: 'var(--g-line)', background: 'var(--g-panel)' }}
        >
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex items-center justify-center w-11 h-11 -ml-2 rounded-lg glass-nav-item"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <AppBrand />
        </header>

        <DeferredTickers />
        <main
          className={cn(
            'flex-1 min-h-0 min-w-0 relative',
            isMap || isTeams ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 lg:px-7 lg:py-6',
          )}
        >
          <div className={cn('h-full min-h-0', (isMap || isTeams) && 'px-3 py-3 sm:px-5')}>
            <Outlet />
          </div>
        </main>
      </div>
      <AIChatWidget />
    </div>
  )
}
