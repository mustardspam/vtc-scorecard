import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { ThemeProvider } from './context/ThemeContext'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import DashboardPage from './pages/DashboardPage'
import ScoresPage from './pages/ScoresPage'
import FeedbackPage from './pages/FeedbackPage'
import SubmitFeedbackPage from './pages/SubmitFeedbackPage'
import UploadsPage from './pages/UploadsPage'
import SnapshotsPage from './pages/SnapshotsPage'
import ActivityPage from './pages/ActivityPage'
import AdminPage from './pages/AdminPage'
import DataPage from './pages/DataPage'
import CommunityPage from './pages/CommunityPage'
import DigestPage from './pages/DigestPage'

export default function App() {
  const { initialize, loading } = useAuth()

  useEffect(() => {
    initialize()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#f3f1ea' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto" style={{ borderColor: '#087482' }} />
          <p className="mt-4 text-sm" style={{ color: '#525249', opacity: 0.6 }}>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <ThemeProvider>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={
        <ProtectedRoute allowedRoles={['admin', 'manager', 'viewer']}>
          <AppLayout />
        </ProtectedRoute>
      }>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/scores" element={<ScoresPage />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="/feedback/submit" element={<SubmitFeedbackPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/uploads" element={<UploadsPage />} />
        <Route path="/snapshots" element={<SnapshotsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/community" element={<CommunityPage />} />
        <Route path="/digest" element={<DigestPage />} />
        <Route path="/admin" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminPage />
          </ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </ThemeProvider>
  )
}
