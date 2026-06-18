import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { canManageBusiness } from '@/lib/roles';

/**
 * Returns whether the given pay period is locked (Approved or Exported PayoutRun exists)
 * and whether the current user is an admin (who can bypass the lock).
 */
export function usePeriodLock(month, number) {
  const { user } = useAuth();
  const isAdmin = canManageBusiness(user);

  const { data: runs = [] } = useQuery({
    queryKey: ['payoutRuns'],
    queryFn: () => base44.entities.PayoutRun.list('-created_date', 50),
    initialData: [],
  });

  const lockedRun = runs.find(
    r =>
      r.pay_period_month === month &&
      r.pay_period_number === number &&
      (r.status === 'Approved' || r.status === 'Exported' || r.locked === true)
  );

  const isLocked = !!lockedRun && !isAdmin;
  const isLockedForAdmin = !!lockedRun; // true even for admin — used to show info banner

  return { isLocked, isAdmin, isLockedForAdmin, lockedRun };
}