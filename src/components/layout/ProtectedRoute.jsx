import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import AppLoadingScreen from './AppLoadingScreen'

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading, logout } = useAuth()
  const location = useLocation()

  if (loading) return <AppLoadingScreen />

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  if (!profile) return <AppLoadingScreen message="Loading profile..." />

  if (profile.is_active === false) {
    return (
      <div className="glass-auth-screen">
        <div className="glass-auth-card text-center py-8 px-6">
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--g-text)' }}>Account disabled</p>
          <p className="text-sm mb-4" style={{ color: 'var(--g-dim)' }}>
            Your account ({profile.email}) has been disabled. Contact an administrator if you need access restored.
          </p>
          <button type="button" onClick={logout} className="glass-btn-secondary text-sm py-2 px-4">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
