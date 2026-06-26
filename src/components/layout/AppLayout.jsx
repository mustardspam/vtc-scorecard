import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AIChatWidget from './AIChatWidget'
import WeeklyLeaderboardTicker from './WeeklyLeaderboardTicker'
import HotStreakTicker from './HotStreakTicker'

const SIDEBAR_W = 236

export default function AppLayout() {
  return (
    <div className="h-screen overflow-hidden" style={{ background: 'var(--g-backdrop)' }}>
      <Sidebar />
      <div
        className="flex flex-col h-screen min-w-0 overflow-hidden"
        style={{ marginLeft: SIDEBAR_W, width: `calc(100vw - ${SIDEBAR_W}px)` }}
      >
        <HotStreakTicker />
        <WeeklyLeaderboardTicker />
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 relative px-5 py-5 sm:px-6 lg:px-7 lg:py-6">
          <Outlet />
        </main>
      </div>
      <AIChatWidget />
    </div>
  )
}
