import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PayPeriodSelector from '@/components/shared/PayPeriodSelector';
import { getCurrentPayPeriod } from '@/lib/payPeriodUtils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Trash2, Pencil, Loader2, ChevronUp, ChevronDown, ChevronsUpDown, BanIcon, CheckCircle2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { toast } from 'sonner';
import { usePeriodLock } from '@/hooks/usePeriodLock';
import PeriodLockBanner from '@/components/shared/PeriodLockBanner';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';

const MATCH_STATUSES = [
  'Matched', 'Ready for Payout', 'Missing Reservation', 'Missing Hostaway Task',
  'Missing Cleaner', 'Needs Review', 'Amount Error', 'Duplicate', 'Non-Cleaning Line', 'Future Period',
  'Do Not Payout', 'Payout Needs to be Verified',
];
const FEE_TYPES = ['Cleaning Fee', 'Pet Fee', 'Error / Needs Review'];

const feeTypeColor = (ft) => {
  if (ft === 'Cleaning Fee') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (ft === 'Pet Fee') return 'bg-purple-100 text-purple-700 border-purple-200';
  return 'bg-red-100 text-red-700 border-red-200';
};

function SortIcon({ field, sort }) {
  if (sort.field !== field) return <ChevronsUpDown className="w-3 h-3 ml-1 opacity-40 inline" />;
  return sort.dir === 'asc'
    ? <ChevronUp className="w-3 h-3 ml-1 inline" />
    : <ChevronDown className="w-3 h-3 ml-1 inline" />;
}

function SortableHead({ label, field, sort, onSort, className }) {
  return (
    <TableHead
      className={`cursor-pointer select-none hover:text-foreground ${className || ''}`}
      onClick={() => onSort(field)}
    >
      {label}<SortIcon field={field} sort={sort} />
    </TableHead>
  );
}

function useSortFilter(lines, month, number) {
  const [sort, setSort] = useState({ field: 'qbo_date', dir: 'desc' });
  const [itemClassFilter, setItemClassFilter] = useState('all');
  const [search, setSearch] = useState('');

  const periodFiltered = useMemo(() => {
    if (!month || !number) return lines;
    return lines.filter(l => {
      const d = l.checkout_date;
      if (!d) return false;
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return false;
      const [, y, mo, day] = m;
      return `${y}${mo}` === month && (parseInt(day) <= 14 ? '001' : '002') === number;
    });
  }, [lines, month, number]);

  const itemClasses = useMemo(() => {
    const s = new Set(periodFiltered.map(l => l.item_class).filter(Boolean));
    return Array.from(s).sort();
  }, [periodFiltered]);

  const toggleSort = (field) => {
    setSort(prev => prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'asc' });
  };

  const filtered = useMemo(() => {
    let result = itemClassFilter === 'all' ? periodFiltered : periodFiltered.filter(l => l.item_class === itemClassFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        [l.num, l.guest, l.item_class, l.listing_name, l.cleaner_name, l.fee_type, l.match_status, l.product_service_description]
          .some(v => String(v || '').toLowerCase().includes(q))
      );
    }
    result = [...result].sort((a, b) => {
      let va = a[sort.field] ?? '';
      let vb = b[sort.field] ?? '';
      if (typeof va === 'number' || typeof vb === 'number') {
        va = parseFloat(va) || 0; vb = parseFloat(vb) || 0;
        return sort.dir === 'asc' ? va - vb : vb - va;
      }
      return sort.dir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return result;
  }, [periodFiltered, sort, itemClassFilter]);

  return { sort, toggleSort, itemClassFilter, setItemClassFilter, itemClasses, filtered, search, setSearch };
}

function LineRow({ l, onEdit, onDelete, deleting, onDoNotPayout, togglingPayout }) {
  const isDoNotPayout = l.match_status === 'Do Not Payout';
  return (
    <TableRow className={isDoNotPayout ? 'opacity-40 bg-slate-50' : l.exception_reason ? 'bg-amber-50/30' : ''}>
      <TableCell className="font-mono text-xs font-semibold">{l.num}</TableCell>
      <TableCell className="text-xs">{l.qbo_date || l.qbo_date_raw}</TableCell>
      <TableCell className="text-sm">{l.item_class}</TableCell>
      <TableCell className="text-sm">{l.guest}</TableCell>
      <TableCell className="text-sm max-w-[160px] truncate" title={l.product_service_description}>{l.product_service_description}</TableCell>
      <TableCell className="text-xs font-mono">{l.checkout_date || '—'}</TableCell>
      <TableCell className="font-mono text-sm font-semibold">${(l.product_service_amount_line || 0).toFixed(2)}</TableCell>
      <TableCell><Badge variant="outline" className={feeTypeColor(l.fee_type)}>{l.fee_type}</Badge></TableCell>
      <TableCell className="font-mono text-sm text-emerald-700 font-semibold">
        {l.recommended_cleaner_payout > 0 ? `$${l.recommended_cleaner_payout.toFixed(2)}` : '—'}
      </TableCell>
      <TableCell className="text-sm">{l.listing_name || '—'}</TableCell>
      <TableCell className="text-sm">{l.cleaner_name || '—'}</TableCell>
      <TableCell>
        {l.match_status ? <StatusBadge status={l.match_status} /> : '—'}
        {l.exception_reason && !isDoNotPayout && (
          <p className="text-[10px] text-amber-700 mt-1 max-w-[140px] leading-tight" title={l.exception_reason}>
            {l.exception_reason.split(';')[0]}
          </p>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {isDoNotPayout ? (
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-emerald-700 gap-1"
              onClick={() => onDoNotPayout(l, false)}
              disabled={togglingPayout === l.id}
            >
              {togglingPayout === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Re-activate
            </Button>
          ) : (
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-slate-700 gap-1"
              onClick={() => onDoNotPayout(l, true)}
              disabled={togglingPayout === l.id}
            >
              {togglingPayout === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <BanIcon className="w-3 h-3" />}
              No Payout
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => onEdit(l)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDelete(l.id)} disabled={deleting === l.id}>
            {deleting === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function AllLinesTable({ lines, onEdit, onDelete, deleting, onDoNotPayout, togglingPayout, month, number }) {
  const { sort, toggleSort, itemClassFilter, setItemClassFilter, itemClasses, filtered, search, setSearch } = useSortFilter(lines, month, number);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input
          placeholder="Search num, guest, listing, cleaner..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={itemClassFilter} onValueChange={setItemClassFilter}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Filter by Item Class" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Item Classes</SelectItem>
            {itemClasses.map(ic => <SelectItem key={ic} value={ic}>{ic}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} rows</span>
      </div>
      <div className="bg-card rounded-xl border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Num / Res Key" field="num" sort={sort} onSort={toggleSort} />
              <SortableHead label="QBO Date" field="qbo_date" sort={sort} onSort={toggleSort} />
              <SortableHead label="Item Class" field="item_class" sort={sort} onSort={toggleSort} />
              <SortableHead label="Guest" field="guest" sort={sort} onSort={toggleSort} />
              <TableHead>Description</TableHead>
              <SortableHead label="Checkout Date" field="checkout_date" sort={sort} onSort={toggleSort} />
              <SortableHead label="Amount" field="product_service_amount_line" sort={sort} onSort={toggleSort} />
              <SortableHead label="Fee Type" field="fee_type" sort={sort} onSort={toggleSort} />
              <SortableHead label="Rec. Payout" field="recommended_cleaner_payout" sort={sort} onSort={toggleSort} />
              <SortableHead label="Listing" field="listing_name" sort={sort} onSort={toggleSort} />
              <SortableHead label="Cleaner" field="cleaner_name" sort={sort} onSort={toggleSort} />
              <SortableHead label="Match Status" field="match_status" sort={sort} onSort={toggleSort} />
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0
              ? <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">No lines match the filter.</TableCell></TableRow>
              : filtered.map(l => <LineRow key={l.id} l={l} onEdit={onEdit} onDelete={onDelete} deleting={deleting} onDoNotPayout={onDoNotPayout} togglingPayout={togglingPayout} />)
            }
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function ByCleanerTable({ lines, month, number }) {
  const { sort, toggleSort, itemClassFilter, setItemClassFilter, itemClasses, filtered, search, setSearch } = useSortFilter(lines, month, number);

  const grouped = useMemo(() => {
    const map = {};
    for (const l of filtered) {
      const key = l.cleaner_name || '— Unassigned —';
      if (!map[key]) map[key] = { cleaner_name: key, lines: [], totalAmount: 0, totalPayout: 0 };
      map[key].lines.push(l);
      map[key].totalAmount += l.product_service_amount_line || 0;
      map[key].totalPayout += l.recommended_cleaner_payout || 0;
    }
    return Object.values(map).sort((a, b) => a.cleaner_name.localeCompare(b.cleaner_name));
  }, [filtered]);

  const [expanded, setExpanded] = useState({});
  const toggle = (name) => setExpanded(p => ({ ...p, [name]: !p[name] }));

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input
          placeholder="Search num, guest, listing, cleaner..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={itemClassFilter} onValueChange={setItemClassFilter}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Filter by Item Class" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Item Classes</SelectItem>
            {itemClasses.map(ic => <SelectItem key={ic} value={ic}>{ic}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{grouped.length} cleaners · {filtered.length} lines</span>
      </div>
      <div className="space-y-3">
        {grouped.map(group => (
          <div key={group.cleaner_name} className="bg-card rounded-xl border overflow-hidden">
            {/* Group header */}
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
              onClick={() => toggle(group.cleaner_name)}
            >
              <div className="flex items-center gap-3">
                {expanded[group.cleaner_name]
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                <span className="font-semibold text-sm">{group.cleaner_name}</span>
                <Badge variant="outline" className="text-xs">{group.lines.length} line{group.lines.length !== 1 ? 's' : ''}</Badge>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-muted-foreground">QBO Total: <span className="font-semibold text-foreground">${group.totalAmount.toFixed(2)}</span></span>
                <span className="text-muted-foreground">Rec. Payout: <span className="font-semibold text-emerald-700">${group.totalPayout.toFixed(2)}</span></span>
              </div>
            </button>
            {/* Expanded rows */}
            {expanded[group.cleaner_name] && (
              <div className="overflow-x-auto border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead label="Num" field="num" sort={sort} onSort={toggleSort} />
                      <SortableHead label="Checkout Date" field="checkout_date" sort={sort} onSort={toggleSort} />
                      <SortableHead label="Item Class" field="item_class" sort={sort} onSort={toggleSort} />
                      <SortableHead label="Listing" field="listing_name" sort={sort} onSort={toggleSort} />
                      <SortableHead label="Guest" field="guest" sort={sort} onSort={toggleSort} />
                      <SortableHead label="Fee Type" field="fee_type" sort={sort} onSort={toggleSort} />
                      <SortableHead label="Amount" field="product_service_amount_line" sort={sort} onSort={toggleSort} />
                      <SortableHead label="Rec. Payout" field="recommended_cleaner_payout" sort={sort} onSort={toggleSort} />
                      <SortableHead label="Match Status" field="match_status" sort={sort} onSort={toggleSort} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.lines.map(l => (
                      <TableRow key={l.id} className={l.exception_reason ? 'bg-amber-50/30' : ''}>
                        <TableCell className="font-mono text-xs font-semibold">{l.num}</TableCell>
                        <TableCell className="text-xs font-mono">{l.checkout_date || '—'}</TableCell>
                        <TableCell className="text-sm">{l.item_class}</TableCell>
                        <TableCell className="text-sm">{l.listing_name || '—'}</TableCell>
                        <TableCell className="text-sm">{l.guest}</TableCell>
                        <TableCell><Badge variant="outline" className={feeTypeColor(l.fee_type)}>{l.fee_type}</Badge></TableCell>
                        <TableCell className="font-mono text-sm font-semibold">${(l.product_service_amount_line || 0).toFixed(2)}</TableCell>
                        <TableCell className="font-mono text-sm text-emerald-700 font-semibold">
                          {l.recommended_cleaner_payout > 0 ? `$${l.recommended_cleaner_payout.toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell>
                          {l.match_status ? <StatusBadge status={l.match_status} /> : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground text-sm">No lines match the filter.</div>
        )}
      </div>
    </>
  );
}

export default function QboRevenue() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const defaultPeriod = getCurrentPayPeriod();
  const [month, setMonth] = useState(defaultPeriod.month);
  const [number, setNumber] = useState(defaultPeriod.number);
  const [deleting, setDeleting] = useState(null);
  const [editLine, setEditLine] = useState(null);
  const [saving, setSaving] = useState(false);
  const [togglingPayout, setTogglingPayout] = useState(null);
  const { isLocked, isAdmin, isLockedForAdmin, lockedRun } = usePeriodLock(month, number);

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['qboLines', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.QboCleanerRevenueLine.list('-created_date', 500)
      : base44.entities.QboCleanerRevenueLine.filter({ business_id: businessId }, '-created_date', 500),
    initialData: [],
  });

  const { data: cleaners = [] } = useQuery({
    queryKey: ['cleaners', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Cleaner.list('cleaner_name', 200)
      : base44.entities.Cleaner.filter({ business_id: businessId }, 'cleaner_name', 200),
    initialData: [],
  });

  const { data: listings = [] } = useQuery({
    queryKey: ['listings', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Listing.list('listing_name', 200)
      : base44.entities.Listing.filter({ business_id: businessId }, 'listing_name', 200),
    initialData: [],
  });

  const handleDelete = async (lineId) => {
    if (isLocked) { toast.error('Period is locked. Contact an Admin.'); return; }
    if (!confirm('Delete this QBO line?')) return;
    setDeleting(lineId);
    await base44.entities.QboCleanerRevenueLine.delete(lineId);
    qc.invalidateQueries({ queryKey: ['qboLines'] });
    setDeleting(null);
  };

  const handleDoNotPayout = async (line, setNoPayoutFlag) => {
    if (isLocked) { toast.error('Period is locked. Contact an Admin.'); return; }
    setTogglingPayout(line.id);
    const prevStatus = line.match_status;
    const newStatus = setNoPayoutFlag ? 'Do Not Payout' : 'Ready for Payout';
    await base44.entities.QboCleanerRevenueLine.update(line.id, {
      match_status: newStatus,
      exception_reason: setNoPayoutFlag ? 'Manually marked as Do Not Payout' : '',
    });
    // If re-activating, update any linked MatchResult
    if (!setNoPayoutFlag) {
      const matchResults = await base44.entities.MatchResult.filter(userIsSystemAdmin ? { qbo_line_id: line.id } : { business_id: businessId, qbo_line_id: line.id });
      for (const mr of matchResults) {
        await base44.entities.MatchResult.update(mr.id, {
          match_status: 'Ready for Payout',
          exception_reason: (mr.exception_reason ? mr.exception_reason + '; ' : '') + '(Adjusted on QBO Revenue)',
          resolved: true,
        });
      }
    }
    qc.invalidateQueries({ queryKey: ['qboLines'] });
    qc.invalidateQueries({ queryKey: ['matchResults'] });
    setTogglingPayout(null);
    toast.success(setNoPayoutFlag ? 'Marked as Do Not Payout' : 'Re-activated — marked Ready for Payout');
  };

  const handleSave = async () => {
    if (isLocked) { toast.error('Period is locked. Contact an Admin.'); return; }
    setSaving(true);
    const { id, ...data } = editLine;
    const wasNotReady = editLine.match_status !== 'Ready for Payout';
    const isNowReady = data.match_status === 'Ready for Payout';
    data.is_cleaning_fee = data.fee_type === 'Cleaning Fee';
    data.is_pet_fee = data.fee_type === 'Pet Fee';
    data.is_error_fee_type = data.fee_type === 'Error / Needs Review';
    if (data.cleaner_id) {
      const c = cleaners.find(c => c.id === data.cleaner_id);
      if (c) data.cleaner_name = c.cleaner_name;
    }
    if (data.listing_id) {
      const l = listings.find(l => l.id === data.listing_id);
      if (l) data.listing_name = l.listing_name;
    }
    // If it was not already 'Ready for Payout' but a non-standard status is being changed,
    // flag as needs verification unless user is explicitly setting to Ready
    if (!isNowReady && wasNotReady && !data.match_status) {
      data.match_status = 'Payout Needs to be Verified';
    }
    await base44.entities.QboCleanerRevenueLine.update(id, data);
    // If changing to Ready for Payout, also update matching
    if (isNowReady && wasNotReady) {
      const matchResults = await base44.entities.MatchResult.filter(userIsSystemAdmin ? { qbo_line_id: id } : { business_id: businessId, qbo_line_id: id });
      for (const mr of matchResults) {
        await base44.entities.MatchResult.update(mr.id, {
          match_status: 'Ready for Payout',
          exception_reason: (mr.exception_reason ? mr.exception_reason + '; ' : '') + '(Adjusted on QBO Revenue)',
          resolved: true,
        });
      }
      toast.success('Line updated — Matching results updated to Ready for Payout');
    } else {
      toast.success('Line updated');
    }
    qc.invalidateQueries({ queryKey: ['qboLines'] });
    qc.invalidateQueries({ queryKey: ['matchResults'] });
    setEditLine(null);
    setSaving(false);
  };

  const cleaningCount = lines.filter(l => l.is_cleaning_fee).length;
  const petCount = lines.filter(l => l.is_pet_fee).length;
  const errorCount = lines.filter(l => l.is_error_fee_type).length;
  const needsReviewCount = lines.filter(l => l.exception_reason).length;

  return (
    <div>
      <PeriodLockBanner isLocked={isLocked} isAdmin={isAdmin} isLockedForAdmin={isLockedForAdmin} runName={lockedRun?.run_name} />
      <PageHeader
        title="QBO Cleaner Revenue"
        description={`${lines.length} lines imported — ${cleaningCount} cleaning, ${petCount} pet, ${errorCount} unclassified`}
        actions={<PayPeriodSelector month={month} number={number} onMonthChange={setMonth} onNumberChange={setNumber} />}
      />

      {lines.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{cleaningCount} Cleaning Fee</span>
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">{petCount} Pet Fee</span>
          {errorCount > 0 && <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">{errorCount} Error / Needs Review</span>}
          {needsReviewCount > 0 && <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{needsReviewCount} Have Exceptions</span>}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading...</div>
      ) : (
        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            <TabsTrigger value="all">All Lines</TabsTrigger>
            <TabsTrigger value="by-cleaner">By Cleaner</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <AllLinesTable lines={lines} onEdit={setEditLine} onDelete={handleDelete} deleting={deleting} onDoNotPayout={handleDoNotPayout} togglingPayout={togglingPayout} month={month} number={number} />
          </TabsContent>
          <TabsContent value="by-cleaner">
            <ByCleanerTable lines={lines} month={month} number={number} />
          </TabsContent>
        </Tabs>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editLine} onOpenChange={(o) => { if (!o) setEditLine(null); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit QBO Line — <span className="font-mono text-sm">{editLine?.num}</span></DialogTitle>
          </DialogHeader>
          {editLine && (
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="col-span-2">
                <Label className="text-xs">Description</Label>
                <Input value={editLine.product_service_description || ''} onChange={e => setEditLine(p => ({ ...p, product_service_description: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">QBO Amount ($)</Label>
                <Input type="number" step="0.01" value={editLine.product_service_amount_line ?? ''} onChange={e => setEditLine(p => ({ ...p, product_service_amount_line: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label className="text-xs">Recommended Payout ($)</Label>
                <Input type="number" step="0.01" value={editLine.recommended_cleaner_payout ?? ''} onChange={e => setEditLine(p => ({ ...p, recommended_cleaner_payout: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label className="text-xs">Fee Type</Label>
                <Select value={editLine.fee_type} onValueChange={v => setEditLine(p => ({ ...p, fee_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FEE_TYPES.map(ft => <SelectItem key={ft} value={ft}>{ft}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Match Status</Label>
                <Select value={editLine.match_status || ''} onValueChange={v => setEditLine(p => ({ ...p, match_status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MATCH_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Checkout Date</Label>
                <Input type="date" value={editLine.checkout_date || ''} onChange={e => setEditLine(p => ({ ...p, checkout_date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">QBO Date</Label>
                <Input type="date" value={editLine.qbo_date || ''} onChange={e => setEditLine(p => ({ ...p, qbo_date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Cleaner</Label>
                <Select value={editLine.cleaner_id || ''} onValueChange={v => setEditLine(p => ({ ...p, cleaner_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select cleaner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>— None —</SelectItem>
                    {cleaners.map(c => <SelectItem key={c.id} value={c.id}>{c.cleaner_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Listing</Label>
                <Select value={editLine.matched_listing_id || ''} onValueChange={v => setEditLine(p => ({ ...p, matched_listing_id: v, listing_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select listing" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>— None —</SelectItem>
                    {listings.map(l => <SelectItem key={l.id} value={l.id}>{l.listing_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Exception / Notes</Label>
                <Input value={editLine.exception_reason || ''} onChange={e => setEditLine(p => ({ ...p, exception_reason: e.target.value }))} placeholder="Clear or update exception notes" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Expense Account</Label>
                <Input value={editLine.recommended_expense_account || ''} onChange={e => setEditLine(p => ({ ...p, recommended_expense_account: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLine(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}