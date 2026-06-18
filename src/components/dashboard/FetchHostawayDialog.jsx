import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId } from '@/lib/roles';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Download, CheckCircle2, FileText } from 'lucide-react';
import { getPayPeriodDates, getPayPeriodLabel } from '@/lib/payPeriodUtils';
import { format, subMonths } from 'date-fns';
import { toast } from 'sonner';

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

export default function FetchHostawayDialog({ open, onClose }) {
  const { user } = useAuth();
  const BUSINESS_ID = getBusinessId(user);
  const [month, setMonth] = useState(format(new Date(), 'yyyyMM'));
  const [number, setNumber] = useState(new Date().getDate() <= 14 ? '001' : '002');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { reservationsCreated, reservationsUpdated, tasksCreated, tasksUpdated, earliestCheckIn }
  const [step, setStep] = useState('select'); // 'select' | 'done'

  const months = generateMonths();

  const safeInvoke = async (payload) => {
    try {
      return await base44.functions.invoke('hostawaySync', payload);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Server error';
      return { data: { success: false, error: msg } };
    }
  };

  const handleFetch = async () => {
  if (!BUSINESS_ID) {
    toast.error('User is not linked to a business. Cannot sync Hostaway data.');
    return;
  }

  setLoading(true);
  const { start, end } = getPayPeriodDates(month, number);

    // Run reservations sync (New/Modified only)
    const resRes = await safeInvoke({
      action: 'sync_reservations',
      business_id: BUSINESS_ID,
      start_date: start,
      end_date: end,
      status_filter: 'new_modified',
    });

    if (!resRes.data?.success) {
      toast.error(resRes.data?.error || 'Reservation sync failed');
      setLoading(false);
      return;
    }

    // Run tasks sync for the same period
    const taskRes = await safeInvoke({
      action: 'sync_tasks',
      business_id: BUSINESS_ID,
      start_date: start,
      end_date: end,
    });

    if (!taskRes.data?.success) {
      toast.error(taskRes.data?.error || 'Task sync failed');
      setLoading(false);
      return;
    }

    // Find earliest check-in from synced reservations
    const syncedReservations = resRes.data.reservations || [];
    const checkIns = syncedReservations
      .map(r => r.check_in_date || r.checkInDate)
      .filter(Boolean)
      .sort();
    const earliestCheckIn = checkIns[0] || start;

    setResult({
      reservationsCreated: resRes.data.created || 0,
      reservationsUpdated: resRes.data.updated || 0,
      tasksCreated: taskRes.data.created || 0,
      tasksUpdated: taskRes.data.updated || 0,
      earliestCheckIn,
      periodEnd: end,
    });
    setStep('done');
    setLoading(false);
  };

  const handleClose = () => {
    setStep('select');
    setResult(null);
    onClose();
  };

  const periodLabel = getPayPeriodLabel(month, number);

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            Fetch Hostaway Reservations & Tasks
          </DialogTitle>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Select a pay period. Checkout dates within that period will be used to filter reservations (New &amp; Modified status only).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Month</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {months.map(m => (
                      <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Period</Label>
                <Select value={number} onValueChange={setNumber}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="001">Period 1 (1st–14th)</SelectItem>
                    <SelectItem value="002">Period 2 (15th–End)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs text-primary/80">
              <strong>Period:</strong> {periodLabel}<br />
              <strong>Checkout date range:</strong> {getPayPeriodDates(month, number).start} → {getPayPeriodDates(month, number).end}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleFetch} disabled={loading}>
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Fetching...</>
                  : <><Download className="w-4 h-4" /> Fetch Data</>}
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-4 py-2">
            {/* Sync summary */}
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4" /> Sync Complete
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-emerald-700 mt-1">
                <span>Reservations created:</span><span className="font-bold">{result.reservationsCreated}</span>
                <span>Reservations updated:</span><span className="font-bold">{result.reservationsUpdated}</span>
                <span>Tasks created:</span><span className="font-bold">{result.tasksCreated}</span>
                <span>Tasks updated:</span><span className="font-bold">{result.tasksUpdated}</span>
              </div>
            </div>

            {/* QBO upload prompt */}
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
                <FileText className="w-4 h-4" /> Next Step: Upload QBO Report
              </div>
              <p className="text-xs text-amber-700 leading-relaxed">
                Please run the <strong>"Cleaning Revenue Report - By Class"</strong> custom report in QuickBooks Online for the following dates and upload the CSV on the Imports page:
              </p>
              <div className="rounded bg-amber-100 border border-amber-200 px-3 py-2 text-xs font-mono text-amber-900 space-y-0.5">
                <div><span className="font-semibold">From date:</span> {result.earliestCheckIn}</div>
                <div><span className="font-semibold">To date:</span> {result.periodEnd}</div>
              </div>
              <p className="text-[11px] text-amber-600">
                The from-date is based on the earliest check-in date from the reservations returned. The to-date is the last day of the selected pay period.
              </p>
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}