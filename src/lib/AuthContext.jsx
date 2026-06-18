import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getAppRole, getBusinessId, getCleanerId, isSystemAdmin } from '@/lib/roles';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(null);

  const loadUser = useCallback(async () => {
    try {
      setIsLoadingAuth(true);
      setAuthError(null);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setAuthChecked(true);
      return currentUser;
    } catch (error) {
      console.error('Failed to load user:', error);
      setUser(null);
      setAuthError({ type: 'auth_required', message: error?.message || 'Authentication required' });
      setAuthChecked(true);
      return null;
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const navigateToLogin = useCallback(() => {
    window.location.href = '/login';
  }, []);

  const logout = useCallback(async () => {
    try {
      if (typeof base44.auth.logout === 'function') {
        await base44.auth.logout();
      } else if (typeof base44.auth.signOut === 'function') {
        await base44.auth.signOut();
      }
    } catch (error) {
      console.warn('Logout failed; redirecting to login anyway:', error);
    } finally {
      setUser(null);
      window.location.href = '/login';
    }
  }, []);

  const value = useMemo(() => ({
    user,
    setUser,
    reloadUser: loadUser,
    checkUserAuth: loadUser,
    isLoadingAuth,
    isLoadingPublicSettings: false,
    authChecked,
    authError,
    isAuthenticated: Boolean(user),
    appRole: getAppRole(user),
    businessId: getBusinessId(user),
    cleanerId: getCleanerId(user),
    isSystemAdmin: isSystemAdmin(user),
    navigateToLogin,
    logout,
  }), [user, loadUser, isLoadingAuth, authChecked, authError, navigateToLogin, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
