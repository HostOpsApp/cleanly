import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PayPeriodSelector from '@/components/shared/PayPeriodSelector';
import { getCurrentPayPeriod } from '@/lib/payPeriodUtils';
import { SortableHead } from '@/components/shared/SortableHead';
import { toast } from 'sonner';
import { usePeriodLock } from '@/hooks/usePeriodLock';
import PeriodLockBanner from '@/components/shared/PeriodLockBanner';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';

function dateMatchesPeriod(dateStr, month, number) {
  if (!dateStr) return false;
  const d = dateStr.substring(0, 10); // YYYY-MM-DD
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, y, mo, day] = m;
  return `${y}${mo}` === month && (parseInt(day) <= 14 ? '001' : '002') === number;
}

export default function Tasks() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const defaultPeriod = getCurrentPayPeriod();
  const [month, setMonth] = useState(defaultPeriod.month);
  const [number, setNumber] = useState(defaultPeriod.number);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'can_start_from', dir: 'asc' });

  const toggleSort = (field) => setSort(prev =>
    prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }
  );

  const { isLocked, isAdmin, isLockedForAdmin, lockedRun } = usePeriodLock(month, number);

  const handleDelete = async (taskId) => {
    if (isLocked) { toast.error('Period is locked. Contact an Admin.'); return; }
    if (!confirm('Delete this task?')) return;
    setDeleting(taskId);
    await base44.entities.CleaningTask.delete(taskId);
    qc.invalidateQueries({ queryKey: ['cleaningTasks'] });
    setDeleting(null);
    toast.success('Task deleted');
  };

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['cleaningTasks', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.CleaningTask.list('-created_date', 200)
      : base44.entities.CleaningTask.filter({ business_id: businessId }, '-created_date', 200),
    initialData: [],
  });

  const { data: reservations = [] } = useQuery({
    queryKey: ['reservations', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Reservation.list('-created_date', 2000)
      : base44.entities.Reservation.filter({ business_id: businessId }, '-created_date', 2000),
    initialData: [],
  });

  const { data: cleaners = [] } = useQuery({
    queryKey: ['cleaners', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Cleaner.list('cleaner_name', 100)
      : base44.entities.Cleaner.filter({ business_id: businessId }, 'cleaner_name', 100),
    initialData: [],
  });

  const filteredTasks = useMemo(() => {
    let rows = tasks.filter(t => dateMatchesPeriod(t.can_start_from, month, number));
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(t =>
        [t.task_id, t.reservation_id, t.normalized_reservation_key, t.task_title, t.assignee_user, t.cleaner_name, t.status, t.listing_name]
          .some(v => String(v || '').toLowerCase().includes(q))
      );
    }
    return [...rows].sort((a, b) => {
      let va = a[sort.field] ?? '';
      let vb = b[sort.field] ?? '';
      if (typeof va === 'number' || typeof vb === 'number') {
        va = parseFloat(va) || 0; vb = parseFloat(vb) || 0;
        return sort.dir === 'asc' ? va - vb : vb - va;
      }
      return sort.dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }, [tasks, month, number, search, sort]);

  const { data: matchResults = [] } = useQuery({
    queryKey: ['matchResults', businessId, userIsSystemAdmin, month, number],
    enabled: queryEnabled,
    queryFn: () => base44.entities.MatchResult.filter(userIsSystemAdmin
      ? { pay_period_month: month, pay_period_number: number }
      : { business_id: businessId, pay_period_month: month, pay_period_number: number }, '-created_date', 500),
    initialData: [],
  });

  // Build email → cleaner lookup (case-insensitive)
  const cleanerByEmail = {};
  cleaners.forEach(c => {
    if (c.email) cleanerByEmail[c.email.trim().toLowerCase()] = c;
  });

  const getCleanerForTask = (task) => {
    if (!task.assignee_user) return null;
    const emailMatch = task.assignee_user.match(/\S+@\S+/);
    const email = emailMatch ? emailMatch[0].toLowerCase() : '';
    const name = task.assignee_user.replace(/\S+@\S+/g, '').trim().toLowerCase();
    const cleanerByName = {};
    cleaners.forEach(c => { if (c.cleaner_name) cleanerByName[c.cleaner_name.trim().toLowerCase()] = c; });
    return cleanerByName[name] || cleanerByEmail[email] || null;
  };

  // Tasks in period with no matching QBO line.
  // MatchResult.task_id stores the internal DB record ID, NOT the Hostaway task_id string,
  // so the only reliable join key is normalized_reservation_key.
  const noMatchTasks = useMemo(() => {
    const matchedKeys = new Set(matchResults.map(r => r.normalized_reservation_key).filter(Boolean));
    return filteredTasks.filter(t => {
      if (t.status?.toLowerCase() === 'cancelled') return false;
      const key = t.normalized_reservation_key?.trim();
      return !key || !matchedKeys.has(key);
    });
  }, [filteredTasks, matchResults]);

  const handleNoMatchAction = async (task, action) => {
    if (isLocked) { toast.error('Period is locked. Contact an Admin.'); return; }
    // Find or create a MatchResult for this task — join on normalized_reservation_key
    const existing = matchResults.find(r => r.normalized_reservation_key === task.normalized_reservation_key);
    const updates = {
      task_id: task.task_id,
      listing_id: task.matched_listing_id || task.hostaway_listing_id,
      listing_name: task.listing_name,
      cleaner_id: task.cleaner_id,
      cleaner_name: task.cleaner_name,
      normalized_reservation_key: task.normalized_reservation_key || task.task_id,
      pay_period_month: month,
      pay_period_number: number,
      resolved: true,
      ...(businessId ? { business_id: businessId } : {}),
    };
    if (action === 'owner_stay') {
      updates.match_status = 'Cancelled Task';
      updates.resolution_notes = 'Owner Stay — no cleaner payout';
      updates.recommended_action = 'Owner Stay';
    } else if (action === 'charge_owner') {
      updates.match_status = 'Needs Review';
      updates.resolution_notes = 'Other — Stay, Charge Owner';
      updates.recommended_action = 'Charge Owner';
    } else if (action === 'do_not_bill') {
      updates.match_status = 'Cancelled Task';
      updates.resolution_notes = 'Other — Do Not Bill Owner';
      updates.recommended_action = 'Do Not Bill';
    } else if (action === 'pay_cleaner') {
      updates.match_status = 'Ready for Payout';
      updates.resolution_notes = 'Pay Cleaner — approved without QBO line';
      updates.recommended_action = 'Pay Cleaner';
      updates.task_cost = task.cost || 0;
    }
    if (existing) {
      await base44.entities.MatchResult.update(existing.id, updates);
    } else {
      await base44.entities.MatchResult.create(updates);
    }
    qc.invalidateQueries({ queryKey: ['matchResults'] });
    toast.success(`Marked as: ${action.replace(/_/g, ' ')}`);
  };

  const handleUpdateNormKeys = async () => {
    setUpdating(true);
    // Build lookup by reservation_id and normalized_reservation_key
    const resByResId = {};
    reservations.forEach(r => {
      if (r.reservation_id) resByResId[String(r.reservation_id).trim()] = r;
      if (r.normalized_reservation_key) resByResId[String(r.normalized_reservation_key).trim()] = r;
    });

    let updated = 0;
    const chunks = [];
    for (let i = 0; i < tasks.length; i += 20) chunks.push(tasks.slice(i, i + 20));
    for (const chunk of chunks) {
      await Promise.all(chunk.map(task => {
        const resId = String(task.reservation_id || '').trim();
        const matched = resByResId[resId];
        if (matched && matched.normalized_reservation_key && task.normalized_reservation_key !== matched.normalized_reservation_key) {
          updated++;
          return base44.entities.CleaningTask.update(task.id, {
            normalized_reservation_key: matched.normalized_reservation_key,
          });
        }
        return Promise.resolve();
      }));
    }
    await qc.invalidateQueries({ queryKey: ['cleaningTasks'] });
    toast.success(`Updated normalized key on ${updated} task(s)`);
    setUpdating(false);
  };

  const handleUpdateCleaners = async () => {
    setUpdating(true);
    let updated = 0;
    const chunks = [];
    for (let i = 0; i < tasks.length; i += 20) chunks.push(tasks.slice(i, i + 20));
    for (const chunk of chunks) {
      await Promise.all(chunk.map(task => {
        const cleaner = getCleanerForTask(task);
        if (cleaner && (task.cleaner_id !== cleaner.id || task.cleaner_name !== cleaner.cleaner_name)) {
          updated++;
          return base44.entities.CleaningTask.update(task.id, {
            cleaner_id: cleaner.id,
            cleaner_name: cleaner.cleaner_name,
          });
        }
        return Promise.resolve();
      }));
    }
    await qc.invalidateQueries({ queryKey: ['cleaningTasks'] });
    toast.success(`Updated cleaner info on ${updated} task(s)`);
    setUpdating(false);
  };

  return (
    <div>
      <PeriodLockBanner isLocked={isLocked} isAdmin={isAdmin} isLockedForAdmin={isLockedForAdmin} runName={lockedRun?.run_name} />
      <PageHeader
        title="Hostaway Cleaning Tasks"
        description={`${filteredTasks.length} of ${tasks.length} tasks`}
        actions={
          <div className="flex items-center gap-2">
            <PayPeriodSelector month={month} number={number} onMonthChange={setMonth} onNumberChange={setNumber} />
            <Button variant="outline" size="sm" onClick={handleUpdateNormKeys} disabled={updating || isLoading || isLocked}>
              <RefreshCw className={`w-4 h-4 mr-2 ${updating ? 'animate-spin' : ''}`} />
              {updating ? 'Updating...' : 'Fix Normalized Keys'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleUpdateCleaners} disabled={updating || isLoading || isLocked}>
              <RefreshCw className={`w-4 h-4 mr-2 ${updating ? 'animate-spin' : ''}`} />
              {updating ? 'Updating...' : 'Update Cleaner Info'}
            </Button>
          </div>
        }
      />
      {/* No Match / Missing QBO Line Section — shown FIRST to highlight exceptions */}
      {noMatchTasks.length > 0 && (
        <div className="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h2 className="text-base font-semibold text-amber-800">Missing QBO Line ({noMatchTasks.length})</h2>
            <span className="text-xs text-amber-700">— These tasks have no matching QBO invoice. Select an action for each before proceeding.</span>
          </div>
          <div className="bg-white rounded-lg border border-amber-200 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Reservation ID</TableHead>
                  <TableHead>Normalized Key</TableHead>
                  <TableHead>Listing</TableHead>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {noMatchTasks.map((t) => {
                  const existingMatch = matchResults.find(r => r.normalized_reservation_key === t.normalized_reservation_key);
                  const currentAction = existingMatch?.recommended_action;
                  return (
                    <TableRow key={t.id} className={currentAction ? 'bg-amber-50/40' : ''}>
                      <TableCell className="font-mono text-xs">{t.task_id}</TableCell>
                      <TableCell className="text-sm max-w-[220px] truncate">{t.task_title || '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-blue-700">{t.reservation_id || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{t.normalized_reservation_key || '—'}</TableCell>
                      <TableCell className="text-sm">{t.listing_name || '—'}</TableCell>
                      <TableCell className="text-sm">{t.cleaner_name || <span className="text-destructive text-xs">No match</span>}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          t.status?.toLowerCase() === 'cancelled' ? 'bg-slate-100 text-slate-500 border-slate-200' :
                          t.status?.toLowerCase() === 'completed' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                          'bg-blue-100 text-blue-700 border-blue-200'
                        }>{t.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">${(t.cost || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-xs">{t.can_start_from?.substring(0, 10)}</TableCell>
                      <TableCell className="min-w-[220px]">
                        <Select
                          value={currentAction || ''}
                          onValueChange={(val) => handleNoMatchAction(t, val)}
                          disabled={isLocked}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select action..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner_stay">Owner Stay</SelectItem>
                            <SelectItem value="charge_owner">Other — Stay, Charge Owner</SelectItem>
                            <SelectItem value="do_not_bill">Other — Do Not Bill Owner</SelectItem>
                            <SelectItem value="pay_cleaner">Pay Cleaner</SelectItem>
                          </SelectContent>
                        </Select>
                        {currentAction && (
                          <p className="text-xs text-amber-700 mt-1">Resolved: {currentAction.replace(/_/g, ' ')}</p>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="mb-3">
        <Input
          placeholder="Search task ID, reservation, key, title, cleaner, assignee..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <div className="bg-card rounded-xl border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Task ID" field="task_id" sort={sort} onSort={toggleSort} />
              <SortableHead label="Reservation ID" field="reservation_id" sort={sort} onSort={toggleSort} />
              <SortableHead label="Normalized Key" field="normalized_reservation_key" sort={sort} onSort={toggleSort} />
              <SortableHead label="Title" field="task_title" sort={sort} onSort={toggleSort} />
              <SortableHead label="Assignee" field="assignee_user" sort={sort} onSort={toggleSort} />
              <SortableHead label="Cleaner Name" field="cleaner_name" sort={sort} onSort={toggleSort} />
              <SortableHead label="Code" field="cleaner_code" sort={sort} onSort={toggleSort} />
              <SortableHead label="Status" field="status" sort={sort} onSort={toggleSort} />
              <SortableHead label="Cost" field="cost" sort={sort} onSort={toggleSort} />
              <SortableHead label="Start" field="can_start_from" sort={sort} onSort={toggleSort} />
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : filteredTasks.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No tasks found for this period.</TableCell></TableRow>
            ) : filteredTasks.map((t) => {
            const cleaner = getCleanerForTask(t);
            return (
            <TableRow key={t.id} className={t.status?.toLowerCase() === 'cancelled' ? 'opacity-50' : ''}>
              <TableCell className="font-mono text-xs">{t.task_id}</TableCell>
              <TableCell className="font-mono text-xs text-blue-700 font-semibold">{t.reservation_id}</TableCell>
              <TableCell className="font-mono text-xs font-semibold">{t.normalized_reservation_key}</TableCell>
              <TableCell className="text-sm max-w-[200px] truncate">{t.task_title}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{t.assignee_user}</TableCell>
              <TableCell className="text-sm font-medium">{cleaner?.cleaner_name || <span className="text-destructive text-xs">No match</span>}</TableCell>
              <TableCell className="font-mono text-xs">{cleaner?.cleaner_code || '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={
                    t.status?.toLowerCase() === 'cancelled' ? 'bg-slate-100 text-slate-500 border-slate-200' :
                    t.status?.toLowerCase() === 'completed' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                    'bg-blue-100 text-blue-700 border-blue-200'
                  }>{t.status}</Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">${(t.cost || 0).toFixed(2)}</TableCell>
                <TableCell className="text-xs">{t.can_start_from?.substring(0, 10)}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(t.id)} disabled={deleting === t.id || isLocked}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
              );})}

          </TableBody>
        </Table>
      </div>

    </div>
  );
}