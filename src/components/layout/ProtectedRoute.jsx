import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import AppLoadingScreen from './AppLoadingScreen'

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth()

  if (loading) return <AppLoadingScreen />

  if (!user) return <Navigate to="/login" replace />

  if (!profile) return <AppLoadingScreen message="Loading profile..." />

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
