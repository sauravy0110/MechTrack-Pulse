import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import useAuthStore from './stores/authStore';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import BrandIntro, { useShowBrandIntro } from './components/BrandIntro';

import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

function ProtectedRoute({ children }) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace />;
  if (user?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

function ProtectedAdminRoute({ children }) {
  if (!localStorage.getItem('admin_token')) {
    return <Navigate to="/admin/login" replace />;
  }
  return children;
}

function PublicAdminRoute({ children }) {
  if (localStorage.getItem('admin_token')) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return children;
}

export default function App() {
  const shouldPlayIntro = useShowBrandIntro();
  const [introPlaying, setIntroPlaying] = useState(shouldPlayIntro);
  const [appReady, setAppReady] = useState(!shouldPlayIntro);

  const handleIntroComplete = () => {
    setIntroPlaying(false);
    // Small delay so the overlay fade-out and content fade-in overlap smoothly
    setTimeout(() => setAppReady(true), 50);
  };

  // Build crossfade class
  const appClass = !shouldPlayIntro
    ? 'app-root app-no-intro'
    : `app-root ${appReady ? 'app-ready' : ''}`;

  return (
    <>
      {introPlaying && (
        <BrandIntro onComplete={handleIntroComplete} />
      )}
      <div className={appClass}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
            <Route
              path="/admin/login"
              element={
                <PublicAdminRoute>
                  <AdminLogin />
                </PublicAdminRoute>
              }
            />
            <Route
              path="/admin/dashboard"
              element={
                <ProtectedAdminRoute>
                  <AdminDashboard />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="/change-password"
              element={
                <ProtectedRoute>
                  <ChangePasswordPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </div>
    </>
  );
}

