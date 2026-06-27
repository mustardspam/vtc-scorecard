import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import AppLoadingScreen from './AppLoadingScreen'

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading, logout, fetchProfile } = useAuth()
  const location = useLocation()
  const [retrying, setRetrying] = useState(false)

  if (loading) return <AppLoadingScreen />

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  // A signed-in user with no profile means the profile fetch failed (transient
  // network/RLS error). Don't spin forever — offer a recovery path.
  if (!profile) {
    async function retry() {
      setRetrying(true)
      try {
        const fresh = await fetchProfile(user.id)
        useAuth.setState({ profile: fresh })
      } finally {
        setRetrying(false)
      }
    }
    return (
      <div className="glass-auth-screen">
        <div className="glass-auth-card text-center py-8 px-6">
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--g-text)' }}>Couldn’t load your profile</p>
          <p className="text-sm mb-4" style={{ color: 'var(--g-dim)' }}>
            There was a problem loading your account. Check your connection and try again.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button type="button" onClick={retry} disabled={retrying} className="glass-btn-primary text-sm py-2 px-4 disabled:opacity-60">
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
            <button type="button" onClick={logout} className="glass-btn-secondary text-sm py-2 px-4">
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }

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
