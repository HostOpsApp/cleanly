import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId } from '@/lib/roles';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Download, Upload, GitCompare, FileX, CreditCard, Printer,
  CheckCircle2, Loader2, ChevronRight, Info, Plus
} from 'lucide-react';
import { format, subMonths } from 'date-fns';
import { parseCSV, normalizeDate, col } from '@/lib/csvParser';
import { getCurrentPayPeriod, getPayPeriodDates, generateBillNumber } from '@/lib/payPeriodUtils';
import PayoutItemsTable from '@/components/payouts/PayoutItemsTable';
import PayoutItemDialog from '@/components/payouts/PayoutItemDialog';
import ExceptionsStep from '@/components/wizard/ExceptionsStep';

// ── helpers (mirrored from Imports) ──────────────────────────────────────────

function detectPayPeriod(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, year, mo, day] = m;
  return { month: `${year}${mo}`, number: parseInt(day) <= 14 ? '001' : '002' };
}

function periodLabel(month, number) {
  if (!month) return '—';
  const year = month.substring(0, 4);
  const mo = month.substring(4, 6);
  const half = number === '001' ? '1–14' : '15–end';
  return `${year}-${mo} (${half})`;
}

function deriveQboReservationKey(num) {
  if (!num) return '';
  const trimmed = num.trim();
  const hmMatch = trimmed.match(/HM\w{8}/i);
  if (hmMatch) return hmMatch[0].toUpperCase();
  if (/^HM/i.test(trimmed) && trimmed.length >= 10) return trimmed.substring(0, 10).toUpperCase();
  return trimmed;
}

function extractCheckoutFromDescription(description) {
  if (!description) return '';
  const parts = description.split('|');
  if (parts.length >= 2) {
    const segment = parts[1].trim();
    const rangeMatch = segment.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
    if (rangeMatch) return rangeMatch[2];
    if (/^\d{4}-\d{2}-\d{2}$/.test(segment)) return segment;
  }
  return '';
}

function classifyQboFeeType(description) {
  if (!description) return { feeType: 'Error / Needs Review', isCleaning: false, isPet: false, isError: true };
  const d = description.trim().toLowerCase();
  if (d.startsWith('cleaning') || d.includes('cleaning fee'))
    return { feeType: 'Cleaning Fee', isCleaning: true, isPet: false, isError: false };
  if (d.startsWith('pet') || d.includes('pet fee'))
    return { feeType: 'Pet Fee', isCleaning: false, isPet: true, isError: false };
  return { feeType: 'Error / Needs Review', isCleaning: false, isPet: false, isError: true };
}

function generateMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = subMonths(now, i);
    months.push(format(d, 'yyyyMM'));
  }
  return months;
}

function formatMonth(yyyymm) {
  const y = yyyymm.substring(0, 4);
  const m = yyyymm.substring(4, 6);
  return format(new Date(parseInt(y), parseInt(m) - 1, 1), 'MMMM yyyy');
}

const STEPS = [
  { id: 1, label: 'Fetch Hostaway Data', icon: Download, description: 'Sync reservations & tasks from Hostaway API' },
  { id: 2, label: 'Upload QBO CSV', icon: Upload, description: 'Upload QuickBooks cleaning revenue report' },
  { id: 3, label: 'Run Matching', icon: GitCompare, description: 'Match tasks, reservations, and QBO lines' },
  { id: 4, label: 'Review Exceptions', icon: FileX, description: 'Handle tasks missing a QBO line' },
  { id: 5, label: 'Generate Payout Run', icon: CreditCard, description: 'Create payout lines for all cleaners' },
  { id: 6, label: 'Export Bills', icon: Printer, description: 'Print or export cleaner bill receipts' },
];

// ── Step status indicator ─────────────────────────────────────────────────────
function StepIndicator({ steps, currentStep, completedSteps }) {
  return (
    <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-2">
      {steps.map((step, idx) => {
        const done = completedSteps.has(step.id);
        const active = currentStep === step.id;
        return (
          <div key={step.id} className="flex items-center">
            <div className={`flex flex-col items-center min-w-[80px] ${active ? 'opacity-100' : done ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                done ? 'bg-emerald-600 border-emerald-600 text-white' :
                active ? 'bg-primary border-primary text-white' :
                'bg-card border-border text-muted-foreground'
              }`}>
                {done ? <CheckCircle2 className="w-5 h-5" /> : <span className="text-sm font-bold">{step.id}</span>}
              </div>
              <span className={`text-[11px] font-medium text-center mt-1 leading-tight max-w-[80px] ${active ? 'text-primary' : done ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`h-0.5 w-8 flex-shrink-0 mb-5 mx-1 ${completedSteps.has(step.id) ? 'bg-emerald-500' : 'bg-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PayCleaner() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const BUSINESS_ID = getBusinessId(user);
  const defaultPeriod = getCurrentPayPeriod();
  const [month, setMonth] = useState(defaultPeriod.month);
  const [number, setNumber] = useState(defaultPeriod.number);
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState(new Set());

  // Step 1 state
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchResult, setFetchResult] = useState(null);

  // Step 2 state
  const [qboFile, setQboFile] = useState(null);
  const [qboImporting, setQboImporting] = useState(false);
  const [qboResult, setQboResult] = useState(null); // { count }
  const [detectedPeriods, setDetectedPeriods] = useState(null);

  // Step 3 state
  const [matchRunning, setMatchRunning] = useState(false);
  const [matchResult, setMatchResult] = useState(null); // { total, ready, exceptions }

  // Step 4 state
  const [actionLoading, setActionLoading] = useState({});

  // Step 5 state
  const [runName, setRunName] = useState('');
  const [runCreating, setRunCreating] = useState(false);
  const [createdRun, setCreatedRun] = useState(null); // { id, run_name, total_amount, item_count }
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const months = generateMonths();
  const periodDates = getPayPeriodDates(month, number);

  // Live data queries
  const { data: matchResults = [] } = useQuery({
    queryKey: ['wizardMatchResults', BUSINESS_ID, month, number],
    queryFn: () => BUSINESS_ID
      ? base44.entities.MatchResult.filter({ business_id: BUSINESS_ID, pay_period_month: month, pay_period_number: number }, '-created_date', 500)
      : Promise.resolve([]),
    enabled: !!BUSINESS_ID,
    initialData: [],
  });

  const { data: payoutRuns = [] } = useQuery({
    queryKey: ['payoutRuns', BUSINESS_ID],
    queryFn: () => BUSINESS_ID
      ? base44.entities.PayoutRun.filter({ business_id: BUSINESS_ID }, '-created_date', 50)
      : Promise.resolve([]),
    enabled: !!BUSINESS_ID,
    initialData: [],
  });

  const { data: cleaners = [] } = useQuery({
    queryKey: ['cleaners', BUSINESS_ID],
    queryFn: () => BUSINESS_ID
      ? base44.entities.Cleaner.filter({ business_id: BUSINESS_ID }, 'cleaner_name', 100)
      : Promise.resolve([]),
    enabled: !!BUSINESS_ID,
    initialData: [],
  });

  const { data: listings = [] } = useQuery({
    queryKey: ['listings', BUSINESS_ID],
    queryFn: () => BUSINESS_ID
      ? base44.entities.Listing.filter({ business_id: BUSINESS_ID }, 'listing_name', 200)
      : Promise.resolve([]),
    enabled: !!BUSINESS_ID,
    initialData: [],
  });

  // Existing data for the selected period (to show "already run" status)
  const { data: existingReservations = [] } = useQuery({
    queryKey: ['wizardExistingRes', BUSINESS_ID, month, number],
    queryFn: () => BUSINESS_ID
      ? base44.entities.Reservation.filter({ business_id: BUSINESS_ID, source_type: 'API' }, '-created_date', 2000)
      : Promise.resolve([]),
    enabled: !!BUSINESS_ID,
    initialData: [],
  });

  const { data: existingTasks = [] } = useQuery({
    queryKey: ['wizardExistingTasks', BUSINESS_ID, month, number],
    queryFn: () => BUSINESS_ID
      ? base44.entities.CleaningTask.filter({ business_id: BUSINESS_ID, source_type: 'API' }, '-created_date', 2000)
      : Promise.resolve([]),
    enabled: !!BUSINESS_ID,
    initialData: [],
  });

  const { data: existingQboLines = [] } = useQuery({
    queryKey: ['wizardExistingQbo', BUSINESS_ID, month, number],
    queryFn: () => BUSINESS_ID
      ? base44.entities.QboCleanerRevenueLine.filter({ business_id: BUSINESS_ID }, '-created_date', 2000)
      : [],
    enabled: !!BUSINESS_ID,
    });

  const { data: existingPayoutRuns = [] } = useQuery({
    queryKey: ['wizardExistingRuns', BUSINESS_ID, month, number],
    queryFn: () => BUSINESS_ID
      ? base44.entities.PayoutRun.filter({ business_id: BUSINESS_ID, pay_period_month: month, pay_period_number: number }, '-created_date', 10)
      : Promise.resolve([]),
    enabled: !!BUSINESS_ID,
    initialData: [],
  });

  // Derive "already run" summaries from existing data filtered to this period
  const existingPeriodReservations = existingReservations.filter(r => {
    const co = r.check_out_date || '';
    return co >= periodDates.start && co <= periodDates.end;
  });
  const existingPeriodTasks = existingTasks.filter(t => {
    const coDate = t.can_start_from ? t.can_start_from.substring(0, 10) : '';
    return coDate >= periodDates.start && coDate <= periodDates.end;
  });
  const existingPeriodQbo = existingQboLines.filter(q => {
    const co = q.checkout_date || '';
    return co >= periodDates.start && co <= periodDates.end;
  });
  const existingPeriodRun = existingPayoutRuns[0] || null;

  // Resolve createdRun from existing if not set in local state
  const effectiveRun = createdRun || (existingPeriodRun ? {
    id: existingPeriodRun.id,
    run_name: existingPeriodRun.run_name,
    total_amount: existingPeriodRun.total_amount,
    item_count: null,
  } : null);

  const { data: payoutItems = [] } = useQuery({
    queryKey: ['wizardPayoutItems', effectiveRun?.id],
    queryFn: () => effectiveRun?.id
      ? base44.entities.PayoutItem.filter({ business_id: BUSINESS_ID, payout_run_id: effectiveRun.id }, '-created_date', 500)
      : Promise.resolve([]),
    initialData: [],
    enabled: !!BUSINESS_ID && !!effectiveRun?.id,
  });

  // All unresolved exceptions for Step 4
  const exceptionItems = matchResults.filter(r =>
    !r.resolved && !['Ready for Payout', 'Matched', 'Cancelled Task'].includes(r.match_status)
  );
  // Previously resolved items (show for context)
  const resolvedItems = matchResults.filter(r => r.resolved);
  // Legacy alias for backward compat
  const missingQboItems = exceptionItems.filter(r => r.match_status === 'Missing QBO Invoice');

  const markComplete = (stepId) => {
    setCompletedSteps(prev => new Set([...prev, stepId]));
    setCurrentStep(stepId + 1);
  };

  // ── Step 1: Fetch Hostaway ──────────────────────────────────────────────────
  const handleFetchHostaway = async () => {
    if (!BUSINESS_ID) {
      toast.error('User is not linked to a business. Cannot sync Hostaway data.');
      return;
    }
    setFetchLoading(true);
    try {
      const safeInvoke = async (payload) => {
        try { return await base44.functions.invoke('hostawaySync', payload); }
        catch (err) { return { data: { success: false, error: err?.response?.data?.error || err?.message } }; }
      };

      const resRes = await safeInvoke({
        action: 'sync_reservations',
        business_id: BUSINESS_ID,
        start_date: periodDates.start,
        end_date: periodDates.end,
        status_filter: 'new_modified',
      });

      if (!resRes.data?.success) { toast.error(resRes.data?.error || 'Reservation sync failed'); setFetchLoading(false); return; }

      const taskRes = await safeInvoke({
        action: 'sync_tasks',
        business_id: BUSINESS_ID,
        start_date: periodDates.start,
        end_date: periodDates.end,
      });

      if (!taskRes.data?.success) { toast.error(taskRes.data?.error || 'Task sync failed'); setFetchLoading(false); return; }

      const syncedReservations = resRes.data.reservations || [];
      const checkIns = syncedReservations.map(r => r.check_in_date || r.checkInDate).filter(Boolean).sort();
      const earliestCheckIn = checkIns[0] || periodDates.start;

      setFetchResult({
        reservationsCreated: resRes.data.created || 0,
        reservationsUpdated: resRes.data.updated || 0,
        tasksCreated: taskRes.data.created || 0,
        tasksUpdated: taskRes.data.updated || 0,
        earliestCheckIn,
        periodEnd: periodDates.end,
      });
      qc.invalidateQueries();
      toast.success('Hostaway sync complete!');
    } catch (err) {
      toast.error(err.message);
    }
    setFetchLoading(false);
  };

  // ── Step 2: QBO CSV upload ──────────────────────────────────────────────────
  const handleQboFileChange = async (file) => {
    setQboFile(file || null);
    if (!file) { setDetectedPeriods(null); return; }
    const text = await file.text();
    let rows = parseCSV(text);
    const lines = text.split(/\r?\n/);
    const headerLineIdx = lines.findIndex(l => l.trim().startsWith('Date'));
    if (headerLineIdx > 0) rows = parseCSV(lines.slice(headerLineIdx).join('\n'));
    const periods = new Set();
    rows.forEach(r => {
      const desc = col(r, 'Product/Service description', 'Description', 'description', 'Memo', 'Product/Service');
      const checkoutDate = extractCheckoutFromDescription(desc);
      const pp = detectPayPeriod(checkoutDate);
      if (pp) periods.add(`${pp.month}|${pp.number}`);
    });
    setDetectedPeriods(Array.from(periods).sort());
  };

  const handleQboImport = async () => {
    if (!qboFile) return;
    setQboImporting(true);
    try {
      const text = await qboFile.text();
      let rows = parseCSV(text);
      const lines = text.split(/\r?\n/);
      const headerLineIdx = lines.findIndex(l => l.trim().startsWith('Date'));
      if (headerLineIdx > 0) rows = parseCSV(lines.slice(headerLineIdx).join('\n'));

      if (!BUSINESS_ID) {
        toast.error('User is not linked to a business. Cannot import QBO file.');
        setQboImporting(false);
        return;
      }
      const count = await importQboLines(
        rows,
        qboFile.name,
        format(new Date(), 'yyyy-MM-dd HH:mm'),
        BUSINESS_ID
      );
      setQboResult({ count });
      qc.invalidateQueries();
      toast.success(`QBO: ${count} lines imported`);
    } catch (err) {
      toast.error(err.message);
    }
    setQboImporting(false);
  };

  // ── Step 3: Run Matching ────────────────────────────────────────────────────
  const handleRunMatching = async () => {
    if (!BUSINESS_ID) {
      toast.error('User is not linked to a business. Cannot run matching.');
      return;
    }
    setMatchRunning(true);
    try {
      const [allTasks, reservations, allQboLines, listings, rates, cleaners, settings] = await Promise.all([
        base44.entities.CleaningTask.filter({ business_id: BUSINESS_ID }, '-created_date', 1000),
        base44.entities.Reservation.filter({ business_id: BUSINESS_ID }, '-created_date', 1000),
        base44.entities.QboCleanerRevenueLine.filter({ business_id: BUSINESS_ID }, '-created_date', 1000),
        base44.entities.Listing.filter({ business_id: BUSINESS_ID }, 'listing_name', 200),
        base44.entities.ListingCleaningRate.filter({ business_id: BUSINESS_ID }, '-effective_date', 500),
        base44.entities.Cleaner.filter({ business_id: BUSINESS_ID }, 'cleaner_name', 100),
        base44.entities.AppSetting.filter({ business_id: BUSINESS_ID }),
      ]);

      const tasks = allTasks.filter(t => {
        const res = reservations.find(r => r.reservation_id === t.reservation_id);
        const checkoutDate = res?.check_out_date || '';
        return checkoutDate >= periodDates.start && checkoutDate <= periodDates.end;
      });

      const qboLines = allQboLines.filter(q => {
        const checkout = q.checkout_date || '';
        return checkout >= periodDates.start && checkout <= periodDates.end;
      });

      const getSettingVal = (key, def) => {
        const s = settings.find(s => s.setting_key === key);
        return s ? parseFloat(s.setting_value) : def;
      };
      const diffThreshold = getSettingVal('cleaning_fee_diff_threshold', 5.00);
      const diffTolerance = getSettingVal('cleaning_fee_diff_tolerance', 5.10);
      const petPct = getSettingVal('pet_fee_payout_pct', 50);

      // Save prior resolutions before deleting (keyed by normalized_reservation_key + fee_type)
      const priorResolutions = {};
      const oldResults = await base44.entities.MatchResult.filter({ business_id: BUSINESS_ID, pay_period_month: month, pay_period_number: number });
      oldResults.forEach(r => {
        if (r.resolved) {
          priorResolutions[`${r.normalized_reservation_key}||${r.fee_type || 'Cleaning Fee'}`] = {
            resolved: true,
            match_status: r.match_status,
            exception_reason: r.exception_reason,
            resolution_notes: r.resolution_notes,
          };
        }
      });
      for (let i = 0; i < oldResults.length; i += 5) {
        await Promise.all(oldResults.slice(i, i + 5).map(r => base44.entities.MatchResult.delete(r.id)));
        if (i + 5 < oldResults.length) await new Promise(res => setTimeout(res, 200));
      }

      // Build lookups
      const resByKey = {};
      reservations.forEach(r => { if (r.normalized_reservation_key) resByKey[r.normalized_reservation_key] = r; });
      const qboByKey = {};
      qboLines.forEach(q => {
        const key = q.normalized_reservation_key || q.num;
        if (!qboByKey[key]) qboByKey[key] = [];
        qboByKey[key].push(q);
        if (q.num && q.num !== key) {
          if (!qboByKey[q.num]) qboByKey[q.num] = [];
          qboByKey[q.num].push(q);
        }
      });
      const listingByHostawayId = {};
      const listingByName = {};
      listings.forEach(l => {
        if (l.hostaway_listing_id) listingByHostawayId[l.hostaway_listing_id] = l;
        if (l.listing_name) listingByName[l.listing_name.toLowerCase()] = l;
      });
      const ratesByListing = {};
      rates.forEach(r => {
        if (!ratesByListing[r.listing_id]) ratesByListing[r.listing_id] = [];
        ratesByListing[r.listing_id].push(r);
      });
      Object.keys(ratesByListing).forEach(k => ratesByListing[k].sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || '')));
      const cleanerByEmail = {}, cleanerByName = {}, cleanerById = {};
      cleaners.forEach(c => {
        if (c.email) cleanerByEmail[c.email.trim().toLowerCase()] = c;
        if (c.cleaner_name) cleanerByName[c.cleaner_name.trim().toLowerCase()] = c;
        cleanerById[c.id] = c;
      });

      const findExpectedRate = (listingId, reservationCreatedDate) => {
        const lr = ratesByListing[listingId];
        if (!lr || lr.length === 0) return null;
        if (!reservationCreatedDate) return lr[0];
        for (const rate of lr) { if (rate.effective_date <= reservationCreatedDate) return rate; }
        return null;
      };

      tasks.forEach(t => {
        const res = reservations.find(r => r.reservation_id === t.reservation_id);
        if (res?.normalized_reservation_key) t.normalized_reservation_key = res.normalized_reservation_key;
        else t.normalized_reservation_key = t.normalized_reservation_key || t.reservation_id || '';
      });

      const newResults = [];
      const processedKeys = new Set();

      for (const task of tasks) {
        const key = task.normalized_reservation_key;
        if (!key) continue;
        processedKeys.add(key);

        const reservation = resByKey[key] || reservations.find(r => r.reservation_id === task.reservation_id);
        const qboMatches = qboByKey[key] || [];
        const qboCleaningLine = qboMatches.find(q => q.fee_type === 'Cleaning Fee' || q.is_cleaning_fee);
        const qboPetLine = qboMatches.find(q => q.fee_type === 'Pet Fee' || q.is_pet_fee);
        const qboClassKey = (qboCleaningLine?.item_class || qboPetLine?.item_class || '').toLowerCase();
        const listing = listingByHostawayId[task.hostaway_listing_id]
          || listingByName[(task.listing_name || '').toLowerCase()]
          || (qboClassKey && listings.find(l => (l.qbo_class_name || '').toLowerCase() === qboClassKey))
          || null;
        const expectedRate = listing ? findExpectedRate(listing.id, reservation?.reservation_created_date) : null;
        const assigneeRaw = (task.assignee_user || '').trim();
        const assigneeEmailMatch = assigneeRaw.match(/\S+@\S+/);
        const assigneeEmail = assigneeEmailMatch ? assigneeEmailMatch[0].toLowerCase() : '';
        const assigneeName = assigneeRaw.replace(/\S+@\S+/g, '').trim().toLowerCase();
        const cleaner = (task.cleaner_id && cleanerById[task.cleaner_id])
          || cleanerByEmail[assigneeEmail]
          || cleanerByName[assigneeName]
          || (listing?.default_cleaner_id ? cleanerById[listing.default_cleaner_id] : null);

        let matchStatus = 'Matched', exceptionReason = '', recommendedAction = '';
        if (task.status?.toLowerCase() === 'cancelled') {
          matchStatus = 'Cancelled Task'; exceptionReason = 'Task is cancelled';
        } else if (!qboCleaningLine && !qboPetLine) {
          matchStatus = 'Missing QBO Invoice'; exceptionReason = 'No QBO invoice found for this reservation';
        } else if (!cleaner) {
          matchStatus = 'Missing Cleaner'; exceptionReason = 'No cleaner assigned';
        } else if (qboCleaningLine && task.cost > (qboCleaningLine.product_service_amount_line ?? 0)) {
          matchStatus = 'Amount Exception'; exceptionReason = `Task cost exceeds QBO fee`;
        } else if (qboCleaningLine && ((qboCleaningLine.product_service_amount_line ?? 0) - task.cost) > diffTolerance) {
          matchStatus = 'Amount Exception'; exceptionReason = `QBO fee exceeds task cost by more than $${diffTolerance}`;
          recommendedAction = `Pay $${((qboCleaningLine.product_service_amount_line ?? 0) - diffThreshold).toFixed(2)}`;
        } else {
          matchStatus = 'Ready for Payout';
        }
        if (!listing && (matchStatus === 'Matched' || matchStatus === 'Ready for Payout')) {
          exceptionReason = (exceptionReason ? exceptionReason + '; ' : '') + 'Listing not found';
          matchStatus = 'Needs Review';
        }

        newResults.push({
          business_id: BUSINESS_ID,
          reservation_id: reservation?.reservation_id || task.reservation_id,
          normalized_reservation_key: key,
          task_id: task.id,
          qbo_line_id: qboCleaningLine?.id || '',
          listing_id: listing?.id || '',
          listing_name: task.listing_name || listing?.listing_name || '',
          guest_name: reservation?.guest_name || '',
          checkout_date: reservation?.check_out_date || '',
          reservation_created_date: reservation?.reservation_created_date || '',
          cleaner_id: cleaner?.id || '',
          cleaner_name: cleaner?.cleaner_name || '',
          task_status: task.status || '',
          qbo_amount: qboCleaningLine?.product_service_amount_line ?? 0,
          task_cost: task.cost || 0,
          expected_cleaning_cost: expectedRate?.cleaning_cost || 0,
          fee_type: 'Cleaning Fee',
          match_status: matchStatus,
          exception_reason: exceptionReason,
          recommended_action: recommendedAction,
          pay_period_month: month,
          pay_period_number: number,
        });

        if (qboPetLine) {
          newResults.push({
            business_id: BUSINESS_ID,
            reservation_id: reservation?.reservation_id || task.reservation_id,
            normalized_reservation_key: key,
            task_id: task.id,
            qbo_line_id: qboPetLine.id,
            listing_id: listing?.id || '',
            listing_name: task.listing_name || listing?.listing_name || '',
            guest_name: reservation?.guest_name || '',
            checkout_date: reservation?.check_out_date || '',
            reservation_created_date: reservation?.reservation_created_date || '',
            cleaner_id: cleaner?.id || '',
            cleaner_name: cleaner?.cleaner_name || '',
            task_status: task.status || '',
            qbo_amount: qboPetLine.product_service_amount_line ?? 0,
            task_cost: 0,
            expected_cleaning_cost: 0,
            fee_type: 'Pet Fee',
            match_status: cleaner ? 'Ready for Payout' : 'Missing Cleaner',
            exception_reason: cleaner ? '' : 'No cleaner assigned',
            recommended_action: cleaner ? `Pay ${petPct}% = $${((qboPetLine.product_service_amount_line ?? 0) * petPct / 100).toFixed(2)}` : '',
            pay_period_month: month,
            pay_period_number: number,
          });
        }
      }

      for (const [key, lines] of Object.entries(qboByKey)) {
        if (processedKeys.has(key)) continue;
        for (const qboLine of lines) {
          const reservation = resByKey[key];
          newResults.push({
            business_id: BUSINESS_ID,
            reservation_id: reservation?.reservation_id || '',
            normalized_reservation_key: key,
            qbo_line_id: qboLine.id,
            listing_name: qboLine.qbo_class || '',
            guest_name: qboLine.guest || reservation?.guest_name || '',
            checkout_date: qboLine.checkout_date || reservation?.check_out_date || '',
            qbo_amount: qboLine.product_service_amount_line ?? 0,
            fee_type: qboLine.fee_type || 'Cleaning Fee',
            match_status: 'Missing Hostaway Task',
            exception_reason: 'QBO invoice line has no matching Hostaway task',
            pay_period_month: month,
            pay_period_number: number,
          });
        }
      }

      // Re-apply prior resolutions to newly generated results
      newResults.forEach(r => {
        const priorKey = `${r.normalized_reservation_key}||${r.fee_type || 'Cleaning Fee'}`;
        const prior = priorResolutions[priorKey];
        if (prior) {
          r.resolved = prior.resolved;
          r.match_status = prior.match_status;
          r.exception_reason = prior.exception_reason;
          r.resolution_notes = prior.resolution_notes;
        }
      });

      for (let i = 0; i < newResults.length; i += 20) {
        await base44.entities.MatchResult.bulkCreate(newResults.slice(i, i + 20));
        if (i + 20 < newResults.length) await new Promise(res => setTimeout(res, 300));
      }

      const ready = newResults.filter(r => r.match_status === 'Ready for Payout').length;
      const exceptions = newResults.filter(r => !r.resolved && !['Ready for Payout', 'Matched'].includes(r.match_status)).length;
      setMatchResult({ total: newResults.length, ready, exceptions });
      qc.invalidateQueries();
      toast.success(`Matching complete: ${newResults.length} results (${Object.keys(priorResolutions).length} resolutions preserved)`);
    } catch (err) {
      toast.error(err.message);
    }
    setMatchRunning(false);
  };

  // ── Step 4: Handle exception resolution ────────────────────────────────────
  const handleNoMatchAction = async (result, action) => {
    setActionLoading(p => ({ ...p, [result.id]: true }));
    const map = {
      owner_stay:         { match_status: 'Needs Review',     exception_reason: 'Owner Stay — no QBO invoice expected',     resolved: true, resolution_notes: 'owner_stay' },
      other_charge_owner: { match_status: 'Needs Review',     exception_reason: 'Other - Stay: Charge Owner',               resolved: true, resolution_notes: 'other_charge_owner' },
      other_do_not_bill:  { match_status: 'Needs Review',     exception_reason: 'Other - Do Not Bill Owner',                resolved: true, resolution_notes: 'other_do_not_bill' },
      pay_cleaner:        { match_status: 'Ready for Payout', exception_reason: 'Manually approved — no QBO line required', resolved: true, resolution_notes: 'pay_cleaner' },
    };
    const update = map[action];
    await base44.entities.MatchResult.update(result.id, update);

    // Also persist resolution on the CleaningTask so re-run matching can restore it
    if (result.task_id) {
      await base44.entities.CleaningTask.update(result.task_id, {
        import_status: `resolved:${update.resolution_notes}`,
        import_exception_reason: update.exception_reason,
      });
    }

    qc.invalidateQueries({ queryKey: ['wizardMatchResults'] });
    setActionLoading(p => ({ ...p, [result.id]: false }));
    toast.success('Exception resolved');
  };

  // ── Step 5: Item CRUD ──────────────────────────────────────────────────────
  const handleSaveItem = async (data) => {
    const cleaner = cleaners.find(c => c.id === data.cleaner_id);
    if (editingItem?.id) {
      await base44.entities.PayoutItem.update(editingItem.id, { ...data, cleaner_name: cleaner?.cleaner_name || data.cleaner_name });
      toast.success('Payout line updated');
    } else {
      await base44.entities.PayoutItem.create({
        ...data,
        business_id: BUSINESS_ID,
        payout_run_id: effectiveRun?.id || null,
        cleaner_name: cleaner?.cleaner_name || '',
        bill_number: cleaner ? generateBillNumber(cleaner.cleaner_code, month, number) : '',
        source: data.source || 'Manual',
        status: data.status || 'Draft',
      });
      toast.success('Payout line added');
    }
    qc.invalidateQueries({ queryKey: ['wizardPayoutItems'] });
    setItemDialogOpen(false);
    setEditingItem(null);
  };

  const handleDeleteItem = async (itemId) => {
    if (!confirm('Delete this payout line?')) return;
    await base44.entities.PayoutItem.delete(itemId);
    qc.invalidateQueries({ queryKey: ['wizardPayoutItems'] });
    toast.success('Deleted');
  };

  const handleDuplicateItem = async (item) => {
    const cleaner = cleaners.find(c => c.id === item.cleaner_id);
    const newItem = { ...item, id: undefined, business_id: BUSINESS_ID, source: 'Duplicate', status: 'Needs Review', duplicate_check_status: 'Possible Duplicate',
      notes: `Duplicated from ${item.id?.slice(-6)} — ${item.description || ''}`,
      bill_number: cleaner ? generateBillNumber(cleaner.cleaner_code, month, number) : item.bill_number,
    };
    delete newItem.id; delete newItem.created_date; delete newItem.updated_date;
    await base44.entities.PayoutItem.create(newItem);
    qc.invalidateQueries({ queryKey: ['wizardPayoutItems'] });
    toast.success('Duplicated');
  };

  // ── Step 5: Create payout run ───────────────────────────────────────────────
  const handleCreateRun = async () => {
    if (!BUSINESS_ID) {
      toast.error('User is not linked to a business. Cannot create payout run.');
      return;
    }
    setRunCreating(true);
    try {
      const dates = getPayPeriodDates(month, number);
      const run = await base44.entities.PayoutRun.create({
        business_id: BUSINESS_ID,
        pay_period_month: month,
        pay_period_number: number,
        run_name: runName || `Payout Run ${month}-${number}`,
        start_date: dates.start,
        end_date: dates.end,
        status: 'Draft',
      });

      const [results, allCleaners, settings] = await Promise.all([
        base44.entities.MatchResult.filter({ business_id: BUSINESS_ID, pay_period_month: month, pay_period_number: number }, '-created_date', 500),
        base44.entities.Cleaner.filter({ business_id: BUSINESS_ID }, 'cleaner_name', 100),
        base44.entities.AppSetting.filter({ business_id: BUSINESS_ID }),
      ]);

      const getSettingVal = (key, def) => {
        const s = settings.find(s => s.setting_key === key);
        return s ? parseFloat(s.setting_value) : def;
      };
      const diffThreshold = getSettingVal('cleaning_fee_diff_threshold', 5.00);
      const diffTolerance = getSettingVal('cleaning_fee_diff_tolerance', 5.10);
      const petPct = getSettingVal('pet_fee_payout_pct', 50);

      const cleanerMap = {};
      allCleaners.forEach(c => { cleanerMap[c.id] = c; });

      const readyResults = results.filter(r =>
        r.match_status === 'Ready for Payout' || (r.resolved && r.match_status !== 'Cancelled Task')
      );

      const items = [];
      for (const r of readyResults) {
        const cleaner = cleanerMap[r.cleaner_id];
        if (!cleaner) continue;
        let payAmount = r.task_cost || 0;
        let source = 'Hostaway Task';
        let expenseAccount = cleaner.default_expense_account || 'Contract labor:Rental Cleanings';
        if (r.fee_type === 'Pet Fee') {
          payAmount = (r.qbo_amount || 0) * petPct / 100;
          source = 'QBO';
          expenseAccount = 'Contract labor:Rental Cleanings:Pet Cleaning';
        } else if (r.fee_type === 'Cleaning Fee') {
          if (r.task_cost > r.qbo_amount && r.qbo_amount > 0) { payAmount = r.qbo_amount; source = 'QBO'; }
          else if ((r.qbo_amount - r.task_cost) > diffTolerance) { payAmount = r.qbo_amount - diffThreshold; source = 'QBO'; }
        }
        items.push({
          business_id: BUSINESS_ID,
          payout_run_id: run.id,
          cleaner_id: r.cleaner_id,
          cleaner_name: cleaner.cleaner_name,
          bill_number: generateBillNumber(cleaner.cleaner_code, month, number),
          reservation_id: r.reservation_id,
          normalized_reservation_key: r.normalized_reservation_key,
          task_id: r.task_id,
          qbo_line_id: r.qbo_line_id,
          listing_id: r.listing_id,
          listing_name: r.listing_name,
          description: `${r.listing_name} - ${r.guest_name}`,
          qbo_class: r.listing_name,
          checkout_date: r.checkout_date,
          reservation_created_date: r.reservation_created_date,
          fee_type: r.fee_type || 'Cleaning Fee',
          expense_account: expenseAccount,
          amount: Math.round(payAmount * 100) / 100,
          source,
          source_id: r.id,
          status: 'Draft',
          include_in_final_payout: true,
          duplicate_check_status: 'Not Checked',
        });
      }

      for (let i = 0; i < items.length; i += 20)
        await base44.entities.PayoutItem.bulkCreate(items.slice(i, i + 20));

      const totalAmount = items.reduce((s, i) => s + i.amount, 0);
      await base44.entities.PayoutRun.update(run.id, { total_amount: totalAmount, status: 'In Review' });

      setCreatedRun({ id: run.id, run_name: run.run_name, total_amount: totalAmount, item_count: items.length });
      qc.invalidateQueries();
      toast.success(`Payout run created: ${items.length} items, $${totalAmount.toFixed(2)}`);
    } catch (err) {
      toast.error(err.message);
    }
    setRunCreating(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight font-heading">Pay Cleaner Wizard</h1>
        <p className="text-sm text-muted-foreground mt-1">Step-by-step guide to process and export cleaner bills</p>
      </div>

      {/* Period Selector */}
      <div className="bg-card rounded-xl border p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Pay Period:</span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map(m => <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={number} onValueChange={setNumber}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="001">Period 1 (1st–14th)</SelectItem>
              <SelectItem value="002">Period 2 (15th–End)</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground font-mono">{periodDates.start} → {periodDates.end}</span>
        </div>
      </div>

      {/* Step Indicator */}
      <StepIndicator steps={STEPS} currentStep={currentStep} completedSteps={completedSteps} />

      {/* Step Panels */}
      <div className="space-y-4">

        {/* STEP 1 */}
        <StepCard step={1} title="Fetch Hostaway Reservations & Tasks" icon={Download}
          currentStep={currentStep} completedSteps={completedSteps} onActivate={() => setCurrentStep(1)}>
          <p className="text-sm text-muted-foreground mb-4">
            Syncs all reservations (New &amp; Modified) and cleaning tasks for the selected pay period checkout date range.
          </p>

          {/* Existing data banner */}
          {!fetchResult && (existingPeriodReservations.length > 0 || existingPeriodTasks.length > 0) && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 mb-4">
              <p className="text-xs font-semibold text-blue-800 mb-1">📋 Existing data found for this period</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-blue-700 mb-2">
                <span>Reservations (API):</span><span className="font-semibold">{existingPeriodReservations.length}</span>
                <span>Tasks (API):</span><span className="font-semibold">{existingPeriodTasks.length}</span>
              </div>
              <p className="text-[11px] text-blue-600">You can use this data or re-fetch to get the latest from Hostaway.</p>
            </div>
          )}

          {fetchResult && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mb-4">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm mb-2">
                <CheckCircle2 className="w-4 h-4" /> Sync Complete
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <span className="text-muted-foreground">Reservations created:</span><span className="font-semibold">{fetchResult.reservationsCreated}</span>
                <span className="text-muted-foreground">Reservations updated:</span><span className="font-semibold">{fetchResult.reservationsUpdated}</span>
                <span className="text-muted-foreground">Tasks created:</span><span className="font-semibold">{fetchResult.tasksCreated}</span>
                <span className="text-muted-foreground">Tasks updated:</span><span className="font-semibold">{fetchResult.tasksUpdated}</span>
              </div>
              {fetchResult.earliestCheckIn && (
                <div className="mt-3 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-mono text-amber-900">
                  <div><span className="font-semibold">QBO from date:</span> {fetchResult.earliestCheckIn}</div>
                  <div><span className="font-semibold">QBO to date:</span> {fetchResult.periodEnd}</div>
                  <p className="text-amber-700 mt-1 not-italic font-sans">Use these dates when running the QBO Cleaning Revenue report.</p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <Button onClick={handleFetchHostaway} disabled={fetchLoading} variant={fetchResult ? 'outline' : 'default'}>
              {fetchLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Fetching...</> : <><Download className="w-4 h-4 mr-2" />{fetchResult ? 'Re-fetch' : 'Fetch Data'}</>}
            </Button>
            {/* Use current data if existing records found but haven't re-fetched this session */}
            {!fetchResult && (existingPeriodReservations.length > 0 || existingPeriodTasks.length > 0) && (
              <Button variant="outline" onClick={() => markComplete(1)}>
                Use Current Data <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {fetchResult && (
              <Button variant="outline" onClick={() => markComplete(1)}>
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </StepCard>

        {/* STEP 2 */}
        <StepCard step={2} title="Upload QBO Cleaning Revenue CSV" icon={Upload}
          currentStep={currentStep} completedSteps={completedSteps} onActivate={() => setCurrentStep(2)}>
          <p className="text-sm text-muted-foreground mb-4">
            Export the <strong>Cleaning Revenue Report - By Class</strong> from QuickBooks and upload it here. Use the dates shown in Step 1.
          </p>

          {/* Existing QBO data banner */}
          {!qboResult && existingPeriodQbo.length > 0 && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 mb-4">
              <p className="text-xs font-semibold text-blue-800 mb-1">📋 Existing QBO data found for this period</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-blue-700 mb-2">
                <span>QBO revenue lines:</span><span className="font-semibold">{existingPeriodQbo.length}</span>
                <span>Ready for payout:</span><span className="font-semibold">{existingPeriodQbo.filter(q => q.match_status === 'Ready for Payout').length}</span>
              </div>
              <p className="text-[11px] text-blue-600">You can use this data or re-upload a new CSV to replace it.</p>
            </div>
          )}

          {qboResult ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mb-4">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm mb-1">
                <CheckCircle2 className="w-4 h-4" /> Import Complete
              </div>
              <p className="text-sm text-emerald-700"><strong>{qboResult.count}</strong> QBO revenue lines imported.</p>
            </div>
          ) : (
            <div className="space-y-3 mb-4">
              <div className={`border rounded-lg p-4 transition-colors ${qboFile ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                <Label className="font-semibold text-sm mb-1 block">QBO Cleaner Revenue CSV</Label>
                <Input type="file" accept=".csv" onChange={(e) => handleQboFileChange(e.target.files?.[0] || null)} className="text-xs" />
                {qboFile && <p className="text-xs text-primary mt-1 font-medium">{qboFile.name}</p>}
                {detectedPeriods && detectedPeriods.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 items-center">
                    <Info className="w-3 h-3 text-primary/70" />
                    <span className="text-[11px] text-muted-foreground">Detected periods:</span>
                    {detectedPeriods.map(p => {
                      const [mo, num] = p.split('|');
                      return <span key={p} className="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">{periodLabel(mo, num)}</span>;
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            {!qboResult && (
              <Button onClick={handleQboImport} disabled={!qboFile || qboImporting}>
                {qboImporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</> : <><Upload className="w-4 h-4 mr-2" />Import CSV</>}
              </Button>
            )}
            {!qboResult && existingPeriodQbo.length > 0 && (
              <Button variant="outline" onClick={() => markComplete(2)}>
                Use Current Data <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {qboResult && (
              <Button variant="outline" onClick={() => markComplete(2)}>
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </StepCard>

        {/* STEP 3 */}
        <StepCard step={3} title="Run Matching Engine" icon={GitCompare}
          currentStep={currentStep} completedSteps={completedSteps} onActivate={() => setCurrentStep(3)}>
          <p className="text-sm text-muted-foreground mb-4">
            Compares Hostaway tasks, reservations, and QBO lines to calculate recommended payouts and flag exceptions.
          </p>

          {/* Existing match results banner */}
          {!matchResult && matchResults.length > 0 && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 mb-4">
              <p className="text-xs font-semibold text-blue-800 mb-1">📋 Matching already run for this period</p>
              <div className="grid grid-cols-3 gap-4 text-center mt-2 mb-2">
                <div><p className="text-xl font-bold text-foreground">{matchResults.length}</p><p className="text-[11px] text-blue-700">Total Results</p></div>
                <div><p className="text-xl font-bold text-emerald-600">{matchResults.filter(r => r.match_status === 'Ready for Payout').length}</p><p className="text-[11px] text-blue-700">Ready for Payout</p></div>
                <div><p className="text-xl font-bold text-amber-600">{matchResults.filter(r => !['Ready for Payout', 'Matched'].includes(r.match_status)).length}</p><p className="text-[11px] text-blue-700">Exceptions</p></div>
              </div>
              <p className="text-[11px] text-blue-600">You can use these results or re-run matching to recalculate.</p>
            </div>
          )}

          {matchResult && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mb-4">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm mb-2">
                <CheckCircle2 className="w-4 h-4" /> Matching Complete
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="text-center"><p className="text-2xl font-bold text-foreground">{matchResult.total}</p><p className="text-xs text-muted-foreground">Total Results</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-emerald-600">{matchResult.ready}</p><p className="text-xs text-muted-foreground">Ready for Payout</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-amber-600">{matchResult.exceptions}</p><p className="text-xs text-muted-foreground">Exceptions</p></div>
              </div>
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <Button onClick={handleRunMatching} disabled={matchRunning} variant={(matchResult || matchResults.length > 0) ? 'outline' : 'default'}>
              {matchRunning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running...</> : <><GitCompare className="w-4 h-4 mr-2" />{(matchResult || matchResults.length > 0) ? 'Re-run Matching' : 'Run Matching'}</>}
            </Button>
            {!matchResult && matchResults.length > 0 && (
              <Button variant="outline" onClick={() => markComplete(3)}>
                Use Current Results <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {matchResult && (
              <Button variant="outline" onClick={() => markComplete(3)}>
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </StepCard>

        {/* STEP 4 */}
        <StepCard step={4} title="Review Exceptions" icon={FileX}
          currentStep={currentStep} completedSteps={completedSteps} onActivate={() => setCurrentStep(4)}>
          <ExceptionsStep
            exceptionItems={exceptionItems}
            resolvedItems={resolvedItems}
            actionLoading={actionLoading}
            onResolve={handleNoMatchAction}
            onContinue={() => markComplete(4)}
          />
        </StepCard>

        {/* STEP 5 */}
        <StepCard step={5} title="Review & Generate Payout Run" icon={CreditCard}
          currentStep={currentStep} completedSteps={completedSteps} onActivate={() => setCurrentStep(5)}>
          <p className="text-sm text-muted-foreground mb-4">
            Creates a payout run from all Ready for Payout match results. Once created, you can add, edit, or delete lines before continuing.
          </p>

          {/* Existing run banner (from DB, not created this session) */}
          {!createdRun && existingPeriodRun && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 mb-4">
              <p className="text-xs font-semibold text-blue-800 mb-1">📋 Payout run already exists for this period</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-blue-700 mb-2">
                <span>Run name:</span><span className="font-semibold">{existingPeriodRun.run_name}</span>
                <span>Status:</span><span className="font-semibold">{existingPeriodRun.status}</span>
                <span>Total:</span><span className="font-semibold font-mono">${(existingPeriodRun.total_amount || 0).toFixed(2)}</span>
                <span>Payout lines:</span><span className="font-semibold">{payoutItems.length}</span>
              </div>
              <p className="text-[11px] text-blue-600">You can edit these lines or create a new run to replace them.</p>
            </div>
          )}

          {!effectiveRun ? (
            <div className="mb-4">
              <Label className="text-sm mb-1.5 block">Run Name (optional)</Label>
              <Input
                placeholder={`Payout Run ${month}-${number}`}
                value={runName}
                onChange={e => setRunName(e.target.value)}
                className="max-w-xs"
              />
            </div>
          ) : createdRun ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Payout Run Created: {createdRun.run_name}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-mono font-bold text-emerald-700">${payoutItems.reduce((s, i) => s + (i.amount || 0), 0).toFixed(2)}</span>
                  <span className="text-muted-foreground">{payoutItems.length} lines</span>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex gap-3 mb-4 flex-wrap">
            {!effectiveRun ? (
              <Button onClick={handleCreateRun} disabled={runCreating}>
                {runCreating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : <><CreditCard className="w-4 h-4 mr-2" />Create Payout Run</>}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => { setEditingItem(null); setItemDialogOpen(true); }}>
                  <Plus className="w-4 h-4 mr-1" />Add Line
                </Button>
                {!createdRun && existingPeriodRun && (
                  <Button size="sm" variant="outline" onClick={() => markComplete(5)}>
                    Use Current Run <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
                {createdRun && (
                  <Button variant="outline" onClick={() => markComplete(5)}>
                    Continue <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </>
            )}
          </div>

          {effectiveRun && payoutItems.length > 0 && (
            <PayoutItemsTable
              items={payoutItems}
              cleaners={cleaners}
              listings={listings}
              isLocked={false}
              isAdmin={true}
              currentRun={effectiveRun}
              onEdit={(item) => { setEditingItem(item); setItemDialogOpen(true); }}
              onDelete={handleDeleteItem}
              onDuplicate={handleDuplicateItem}
            />
          )}

          <PayoutItemDialog
            open={itemDialogOpen}
            onOpenChange={setItemDialogOpen}
            item={editingItem}
            cleaners={cleaners}
            listings={listings}
            onSave={handleSaveItem}
          />
        </StepCard>

        {/* STEP 6 */}
        <StepCard step={6} title="Export Cleaner Bills" icon={Printer}
          currentStep={currentStep} completedSteps={completedSteps} onActivate={() => setCurrentStep(6)}>
          <p className="text-sm text-muted-foreground mb-4">
            Head to the <strong>Export Bills</strong> page to print or email individual cleaner bill receipts and export a QBO-ready CSV.
          </p>
          {effectiveRun && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 mb-4 text-sm">
              <p className="font-medium">Payout run ready: <span className="text-primary">{effectiveRun?.run_name}</span></p>
              <p className="text-xs text-muted-foreground mt-1">Select it in the Export Bills page to print receipts or export CSV.</p>
            </div>
          )}
          <div className="flex gap-3">
            <Button asChild>
              <a href="/export"><Printer className="w-4 h-4 mr-2" />Go to Export Bills</a>
            </Button>
          </div>
        </StepCard>

      </div>
    </div>
  );
}

// ── Collapsible step card ─────────────────────────────────────────────────────
function StepCard({ step, title, icon: Icon, currentStep, completedSteps, onActivate, children }) {
  const isActive = currentStep === step;
  const isDone = completedSteps.has(step);
  const isLocked = step > currentStep && !completedSteps.has(step);

  return (
    <div
      className={`rounded-xl border transition-all ${
        isActive ? 'border-primary/50 shadow-sm' :
        isDone ? 'border-emerald-200 bg-emerald-50/30' :
        'border-border opacity-60'
      }`}
    >
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
        onClick={!isLocked ? onActivate : undefined}
        disabled={isLocked}
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isDone ? 'bg-emerald-600 text-white' :
          isActive ? 'bg-primary text-white' :
          'bg-muted text-muted-foreground'
        }`}>
          {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{title}</span>
            {isDone && <span className="text-xs text-emerald-600 font-medium">Complete</span>}
            {isActive && <span className="text-xs text-primary font-medium">In Progress</span>}
          </div>
        </div>
        {!isActive && !isLocked && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>
      {isActive && (
        <div className="px-5 pb-5">
          <div className="border-t pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}

// ── importQboLines (self-contained for wizard) ────────────────────────────────
async function importQboLines(rows, fileName, timestamp, businessId) {
  if (!businessId) {
    throw new Error('Missing business_id. Cannot import QBO cleaner revenue.');
  }

  const [reservations, tasks, listings, rates, cleaners, settings] = await Promise.all([
    base44.entities.Reservation.filter({ business_id: businessId }, '-created_date', 1000),
    base44.entities.CleaningTask.filter({ business_id: businessId }, '-created_date', 1000),
    base44.entities.Listing.filter({ business_id: businessId }, 'listing_name', 200),
    base44.entities.ListingCleaningRate.filter({ business_id: businessId }, '-effective_date', 500),
    base44.entities.Cleaner.filter({ business_id: businessId }, 'cleaner_name', 100),
    base44.entities.AppSetting.filter({ business_id: businessId }),
  ]);

  const getSettingVal = (key, def) => { const s = settings.find(s => s.setting_key === key); return s ? parseFloat(s.setting_value) : def; };
  const diffThreshold = getSettingVal('cleaning_fee_diff_threshold', 5.00);
  const diffTolerance = getSettingVal('cleaning_fee_diff_tolerance', 5.10);
  const petPct = getSettingVal('pet_fee_payout_pct', 50);

  const resByKey = {};
  reservations.forEach(r => { if (r.normalized_reservation_key) resByKey[r.normalized_reservation_key] = r; if (r.reservation_id) resByKey[r.reservation_id] = r; });
  const tasksByKey = {};
  tasks.forEach(t => { const k = t.normalized_reservation_key || t.reservation_id; if (k) { if (!tasksByKey[k]) tasksByKey[k] = []; tasksByKey[k].push(t); } });
  const listingByClass = {}, listingByName2 = {};
  listings.forEach(l => { if (l.qbo_class_name) listingByClass[l.qbo_class_name.trim().toLowerCase()] = l; if (l.listing_name) listingByName2[l.listing_name.trim().toLowerCase()] = l; });
  const ratesByListing = {};
  rates.forEach(rt => { if (!ratesByListing[rt.listing_id]) ratesByListing[rt.listing_id] = []; ratesByListing[rt.listing_id].push(rt); });
  Object.keys(ratesByListing).forEach(k => ratesByListing[k].sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || '')));
  const cleanerById = {};
  cleaners.forEach(c => { cleanerById[c.id] = c; });

  const findExpectedRate = (listingId, reservationCreatedDate) => {
    const lr = ratesByListing[listingId];
    if (!lr || lr.length === 0) return null;
    if (!reservationCreatedDate) return lr[0];
    for (const rate of lr) { if (rate.effective_date <= reservationCreatedDate) return rate; }
    return null;
  };

  const periodGroups = {};
  const seenCleaningKeys = new Set(), seenPetKeys = new Set();

  rows.forEach(r => {
    const desc = col(r, 'Product/Service description', 'Description', 'description', 'Memo', 'Product/Service');
    const numRaw = col(r, 'Num', 'num').trim();
    const normKey = deriveQboReservationKey(numRaw);
    const matchedReservation = resByKey[normKey] || resByKey[numRaw] || null;
    const checkoutDate = extractCheckoutFromDescription(desc) || matchedReservation?.check_out_date || '';
    const pp = detectPayPeriod(checkoutDate) || { month: 'unknown', number: '001' };
    const periodKey = `${pp.month}|${pp.number}`;
    if (!periodGroups[periodKey]) periodGroups[periodKey] = [];
    periodGroups[periodKey].push(r);
  });

  const existingQbo = await base44.entities.QboCleanerRevenueLine.filter({ business_id: businessId }, '-created_date', 2000);
  const existingQboByKey = {};
  existingQbo.forEach(q => { existingQboByKey[`${q.num}||${q.fee_type}`] = q; });

  let totalImported = 0;
  const qboPeriodEntries = Object.entries(periodGroups);
  for (let pi = 0; pi < qboPeriodEntries.length; pi++) {
    const [periodKey, group] = qboPeriodEntries[pi];
    if (pi > 0) await new Promise(res => setTimeout(res, 500));
    const [mo, num] = periodKey.split('|');
    const batch = await base44.entities.ImportBatch.create({
      business_id: businessId,
      batch_name: `QBO Cleaner Revenue - ${timestamp} [${periodLabel(mo, num)}]`,
      pay_period_month: mo === 'unknown' ? '' : mo,
      pay_period_number: mo === 'unknown' ? '' : num,
      import_type: 'QBO Cleaner Revenue',
      uploaded_file_name: fileName,
      status: 'Processing',
      row_count: group.length,
    });

    const records = group.map(r => {
      const dateRaw = col(r, 'Date', 'date');
      const qboDate = normalizeDate(dateRaw);
      const itemClass = col(r, 'Item Class', 'item_class', 'Class', 'class');
      const distributionAccount = col(r, 'Distribution Account', 'distribution_account', 'Account');
      const numRaw = col(r, 'Num', 'num').trim();
      const guest = col(r, 'Guest', 'guest', 'Name', 'Customer Name');
      const desc = col(r, 'Product/Service description', 'Description', 'description', 'Memo', 'Product/Service');
      const amountRaw = col(r, 'Product/service amount line', 'product_service_amount_line', 'Amount', 'amount', 'Line Amount');
      const createdOnLine = col(r, 'Product/Service created on date line', 'Created Date', 'Created');

      const { feeType, isCleaning, isPet, isError } = classifyQboFeeType(desc);
      let amountLine = 0, amountError = false;
      if (!amountRaw || amountRaw.trim() === '') { amountError = true; }
      else { const parsed = parseFloat(amountRaw.replace(/[$,\s()]/g, '')); if (isNaN(parsed)) amountError = true; else amountLine = parsed; }

      const normKey = deriveQboReservationKey(numRaw);
      const matchedListing = itemClass ? listingByClass[itemClass.trim().toLowerCase()] || null : null;
      const matchedReservation = resByKey[normKey] || resByKey[numRaw] || null;
      const taskMatches = tasksByKey[normKey] || tasksByKey[numRaw] || [];
      const matchedTask = taskMatches.length > 0 ? taskMatches[0] : null;
      let matchedCleaner = null;
      if (matchedTask?.cleaner_id) matchedCleaner = cleanerById[matchedTask.cleaner_id] || null;
      if (!matchedCleaner && matchedListing?.default_cleaner_id) matchedCleaner = cleanerById[matchedListing.default_cleaner_id] || null;
      const expectedRate = matchedListing ? findExpectedRate(matchedListing.id, matchedReservation?.reservation_created_date) : null;

      let isDuplicate = false;
      if (isCleaning) { if (seenCleaningKeys.has(normKey)) isDuplicate = true; else seenCleaningKeys.add(normKey); }
      if (isPet) { if (seenPetKeys.has(normKey)) isDuplicate = true; else seenPetKeys.add(normKey); }

      let recommendedPayout = 0;
      let recommendedExpenseAccount = matchedCleaner?.default_expense_account || 'Contract labor:Rental Cleanings';
      if (!amountError && isCleaning) {
        const taskCost = matchedTask?.cost || 0;
        if (taskCost > amountLine) recommendedPayout = amountLine;
        else if ((amountLine - taskCost) > diffTolerance) recommendedPayout = amountLine - diffThreshold;
        else recommendedPayout = taskCost > 0 ? taskCost : amountLine;
      } else if (!amountError && isPet) {
        recommendedPayout = amountLine * (petPct / 100);
        recommendedExpenseAccount = 'Contract labor:Rental Cleanings:Pet Cleaning';
      }

      let matchStatus = 'Matched';
      const exceptionParts = [];
      if (!numRaw) exceptionParts.push('Missing Num');
      if (amountError) { exceptionParts.push('Invalid amount'); matchStatus = 'Amount Error'; }
      if (isError) exceptionParts.push('Not a Cleaning/Pet description');
      if (!matchedListing) exceptionParts.push('Item Class does not match a Listing');
      if (!matchedReservation) exceptionParts.push('Num does not match any Reservation');
      if (isCleaning && !matchedTask) exceptionParts.push('No Cleaning Task found');
      if (!matchedCleaner) exceptionParts.push('Missing cleaner assignment');
      if (isDuplicate) { exceptionParts.push('Duplicate line'); matchStatus = 'Duplicate'; }

      if (matchStatus !== 'Amount Error' && matchStatus !== 'Duplicate') {
        if (exceptionParts.length === 0) matchStatus = 'Ready for Payout';
        else if (!matchedReservation) matchStatus = 'Missing Reservation';
        else if (isCleaning && !matchedTask) matchStatus = 'Missing Hostaway Task';
        else if (!matchedCleaner) matchStatus = 'Missing Cleaner';
        else matchStatus = 'Needs Review';
      }
      if (isError && matchStatus !== 'Amount Error' && matchStatus !== 'Duplicate') matchStatus = 'Non-Cleaning Line';

      const checkoutDate = extractCheckoutFromDescription(desc) || matchedReservation?.check_out_date || '';

      return {
        business_id: businessId,
        import_batch_id: batch.id,
        qbo_date: qboDate,
        qbo_date_raw: dateRaw,
        item_class: itemClass,
        distribution_account: distributionAccount,
        num: numRaw,
        guest,
        product_service_description: desc,
        product_service_amount_line: amountLine,
        product_service_created_on_date_line: createdOnLine,
        normalized_reservation_key: normKey,
        fee_type: feeType,
        is_cleaning_fee: isCleaning,
        is_pet_fee: isPet,
        is_error_fee_type: isError,
        reservation_id: matchedReservation?.reservation_id || '',
        matched_reservation_id: matchedReservation?.id || '',
        matched_task_id: matchedTask?.id || '',
        matched_listing_id: matchedListing?.id || '',
        match_status: matchStatus,
        exception_reason: exceptionParts.join('; '),
        recommended_cleaner_payout: recommendedPayout,
        recommended_expense_account: recommendedExpenseAccount,
        listing_name: matchedListing?.listing_name || matchedReservation?.listing_name || itemClass || '',
        checkout_date: checkoutDate,
        reservation_created_date: matchedReservation?.reservation_created_date || '',
        cleaner_name: matchedCleaner?.cleaner_name || matchedTask?.assignee_user || '',
        cleaner_id: matchedCleaner?.id || '',
      };
    });

    const validRecords = records.filter(Boolean);
    const toCreate = [], toUpdate = [];
    for (const rec of validRecords) {
      const k = `${rec.num}||${rec.fee_type}`;
      const existing = existingQboByKey[k];
      if (!existing) toCreate.push(rec);
      else {
        const changed = existing.product_service_amount_line !== rec.product_service_amount_line || existing.match_status !== rec.match_status || existing.checkout_date !== rec.checkout_date;
        if (changed) toUpdate.push({ id: existing.id, data: rec });
      }
    }

    const chunkSize = 20;
    for (let i = 0; i < toCreate.length; i += chunkSize) {
      await base44.entities.QboCleanerRevenueLine.bulkCreate(toCreate.slice(i, i + chunkSize));
      if (i + chunkSize < toCreate.length) await new Promise(res => setTimeout(res, 300));
    }
    for (let i = 0; i < toUpdate.length; i += chunkSize) {
      await Promise.all(toUpdate.slice(i, i + chunkSize).map(u => base44.entities.QboCleanerRevenueLine.update(u.id, u.data)));
      if (i + chunkSize < toUpdate.length) await new Promise(res => setTimeout(res, 300));
    }

    await base44.entities.ImportBatch.update(batch.id, { status: 'Completed', row_count: validRecords.length });
    totalImported += validRecords.length;
  }
  return totalImported;
}