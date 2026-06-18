import { Lock, ShieldCheck } from 'lucide-react';

/**
 * Shows a banner when a pay period is locked.
 * - Non-admins: red lock banner — all edits blocked.
 * - Admins: amber info banner — edits still allowed.
 */
export default function PeriodLockBanner({ isLocked, isAdmin, isLockedForAdmin, runName }) {
  if (!isLockedForAdmin) return null;

  if (isAdmin) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 mb-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
        <ShieldCheck className="w-4 h-4 flex-shrink-0" />
        <span>
          <strong>Admin Override Active</strong> — This period ({runName}) is finalized. You have admin access to make edits.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 mb-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
      <Lock className="w-4 h-4 flex-shrink-0" />
      <span>
        <strong>Period Locked — {runName}</strong> — This pay period has been finalized. Edits, imports, and deletions are blocked. Contact an Admin to make changes.
      </span>
    </div>
  );
}