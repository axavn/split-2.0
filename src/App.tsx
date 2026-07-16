import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { BottomNav } from './components/BottomNav';
import { AuthProvider, useAuth } from './lib/auth';
import { isSupabaseConfigured } from './lib/supabase';
import { AccountPage } from './pages/AccountPage';
import { AddBillPage } from './pages/AddBillPage';
import { AddPage } from './pages/AddPage';
import { AddPersonPage } from './pages/AddPersonPage';
import { BalanceDetailPage } from './pages/BalanceDetailPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';

// Wraps every signed-in page: redirects anonymous visitors to /login and
// renders the persistent bottom nav (spec §4) under the active page.
function ProtectedShell() {
  const { session, loading } = useAuth();
  if (loading) return <div className="splash">SPLITLY</div>;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <div className="shell">
      <main className="shell__content">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}

export default function App() {
  // A fresh clone has no Supabase keys yet — show the setup checklist instead
  // of a broken login screen.
  if (!isSupabaseConfigured) return <SetupPage />;

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/person/:userId" element={<BalanceDetailPage />} />
            <Route path="/add" element={<AddPage />} />
            <Route path="/add/bill" element={<AddBillPage />} />
            <Route path="/add/person" element={<AddPersonPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
