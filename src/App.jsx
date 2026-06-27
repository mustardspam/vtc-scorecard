import { lazy, Suspense, useEffect } from 'react'

import { Routes, Route, Navigate } from 'react-router-dom'

import { useAuth } from './hooks/useAuth'

import { ThemeProvider } from './context/ThemeContext'

import AppLayout from './components/layout/AppLayout'

import AppLoadingScreen from './components/layout/AppLoadingScreen'

import PageLoader from './components/layout/PageLoader'

import ProtectedRoute from './components/layout/ProtectedRoute'



const LoginPage = lazy(() => import('./pages/LoginPage'))

const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))

const DashboardPage = lazy(() => import('./pages/DashboardPage'))

const ScoresPage = lazy(() => import('./pages/ScoresPage'))

const FeedbackPage = lazy(() => import('./pages/FeedbackPage'))

const SubmitFeedbackPage = lazy(() => import('./pages/SubmitFeedbackPage'))

const UploadsPage = lazy(() => import('./pages/UploadsPage'))

const SnapshotsPage = lazy(() => import('./pages/SnapshotsPage'))

const ActivityPage = lazy(() => import('./pages/ActivityPage'))

const AdminPage = lazy(() => import('./pages/AdminPage'))

const DataPage = lazy(() => import('./pages/DataPage'))

const CommunityPage = lazy(() => import('./pages/CommunityPage'))

const DigestPage = lazy(() => import('./pages/DigestPage'))

const MapPage = lazy(() => import('./pages/MapPage'))

const TeamsPage = lazy(() => import('./pages/TeamsPage'))



function LazyPage({ children }) {

  return <Suspense fallback={<PageLoader />}>{children}</Suspense>

}



export default function App() {

  const { initialize, loading } = useAuth()



  useEffect(() => {

    initialize()

  }, [])



  if (loading) return <AppLoadingScreen message="Loading..." />



  return (

    <ThemeProvider>

    <Routes>

      <Route path="/login" element={<LazyPage><LoginPage /></LazyPage>} />

      <Route path="/reset-password" element={<LazyPage><ResetPasswordPage /></LazyPage>} />



      <Route element={

        <ProtectedRoute allowedRoles={['admin', 'manager', 'viewer']}>

          <AppLayout />

        </ProtectedRoute>

      }>

        <Route path="/dashboard" element={<LazyPage><DashboardPage /></LazyPage>} />

        <Route path="/scores" element={<LazyPage><ScoresPage /></LazyPage>} />

        <Route path="/data" element={<LazyPage><DataPage /></LazyPage>} />

        <Route path="/feedback/submit" element={<LazyPage><SubmitFeedbackPage /></LazyPage>} />

        <Route path="/feedback" element={<LazyPage><FeedbackPage /></LazyPage>} />

        <Route path="/uploads" element={<LazyPage><UploadsPage /></LazyPage>} />

        <Route path="/snapshots" element={<LazyPage><SnapshotsPage /></LazyPage>} />

        <Route path="/activity" element={<LazyPage><ActivityPage /></LazyPage>} />

        <Route path="/community" element={<LazyPage><CommunityPage /></LazyPage>} />

        <Route path="/teams" element={<LazyPage><TeamsPage /></LazyPage>} />

        <Route path="/map" element={<LazyPage><MapPage /></LazyPage>} />

        <Route path="/digest" element={<LazyPage><DigestPage /></LazyPage>} />

        <Route path="/admin" element={

          <ProtectedRoute allowedRoles={['admin']}>

            <LazyPage><AdminPage /></LazyPage>

          </ProtectedRoute>

        } />

      </Route>



      <Route path="*" element={<Navigate to="/dashboard" replace />} />

    </Routes>

    </ThemeProvider>

  )

}


