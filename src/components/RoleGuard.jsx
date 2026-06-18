import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { canAccessPage, getBusinessId, isSystemAdmin } from '@/lib/roles';

export default function RoleGuard({ children }) {
  const { user, isLoadingAuth } = useAuth();
  const location = useLocation();

  if (isLoadingAuth) return null;
  if (!user) return <Navigate to="/login" replace />;

  const businessId = getBusinessId(user);

  // System admin can pass without a business_id. All business users must be linked to a business.
  if (!isSystemAdmin(user) && !businessId) {
    console.error('User is missing business_id:', user);
    return <Navigate to="/unauthorized" replace />;
  }

  if (!canAccessPage(user, location.pathname)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
}
