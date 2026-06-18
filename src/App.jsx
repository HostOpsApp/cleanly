import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Imports from '@/pages/Imports';
import Cleaners from '@/pages/Cleaners';
import Listings from '@/pages/Listings';
import Reservations from '@/pages/Reservations';
import Tasks from '@/pages/Tasks';
import QboRevenue from '@/pages/QboRevenue';
import Matching from '@/pages/Matching';
import Exceptions from '@/pages/Exceptions';
import Payouts from '@/pages/Payouts.jsx';
import Export from '@/pages/Export';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';
import AdminAudit from '@/pages/AdminAudit';
import HostawaySettings from '@/pages/HostawaySettings';
import QboImport from '@/pages/QboImport';
import PayCleaner from '@/pages/PayCleaner';
import Unauthorized from '@/pages/Unauthorized';
import SuperAdmin from '@/pages/SuperAdmin';
import RoleGuard from '@/components/RoleGuard';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading CleanPay...</span>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') { navigateToLogin(); return null; }
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<RoleGuard><Dashboard /></RoleGuard>} />
        <Route path="/imports" element={<RoleGuard><Imports /></RoleGuard>} />
        <Route path="/cleaners" element={<RoleGuard><Cleaners /></RoleGuard>} />
        <Route path="/listings" element={<RoleGuard><Listings /></RoleGuard>} />
        <Route path="/reservations" element={<RoleGuard><Reservations /></RoleGuard>} />
        <Route path="/tasks" element={<RoleGuard><Tasks /></RoleGuard>} />
        <Route path="/qbo-revenue" element={<RoleGuard><QboRevenue /></RoleGuard>} />
        <Route path="/matching" element={<RoleGuard><Matching /></RoleGuard>} />
        <Route path="/exceptions" element={<RoleGuard><Exceptions /></RoleGuard>} />
        <Route path="/payouts" element={<RoleGuard><Payouts /></RoleGuard>} />
        <Route path="/export" element={<RoleGuard><Export /></RoleGuard>} />
        <Route path="/reports" element={<RoleGuard><Reports /></RoleGuard>} />
        <Route path="/settings" element={<RoleGuard><Settings /></RoleGuard>} />
        <Route path="/admin-audit" element={<RoleGuard><AdminAudit /></RoleGuard>} />
        <Route path="/hostaway-settings" element={<RoleGuard><HostawaySettings /></RoleGuard>} />
        <Route path="/qbo-import" element={<RoleGuard><QboImport /></RoleGuard>} />
        <Route path="/pay-cleaner" element={<RoleGuard><PayCleaner /></RoleGuard>} />
        <Route path="/super-admin" element={<RoleGuard><SuperAdmin /></RoleGuard>} />
        <Route path="/unauthorized" element={<Unauthorized />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster richColors position="top-right" />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App