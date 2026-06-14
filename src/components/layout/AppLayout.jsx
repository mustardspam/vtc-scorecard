import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useTheme } from '../../context/ThemeContext'

export default function AppLayout() {
  const { dark } = useTheme()
  return (
    <div className="flex min-h-screen" style={{ backgroundColor: dark ? '#1c1c1a' : undefined }}>
      <Sidebar />
      <main className="flex-1 ml-64 p-8 bg-gray-50">
        <Outlet />
      </main>
    </div>
  )
}
