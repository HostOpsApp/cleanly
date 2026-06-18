import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Upload, GitCompare, AlertTriangle, Download,
  DollarSign, CheckCircle, XCircle, ClipboardList, RefreshCw
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import PayPeriodSelector from '@/components/shared/PayPeriodSelector';
import { getCurrentPayPeriod, getPayPeriodLabel } from '@/lib/payPeriodUtils';
import FetchHostawayDialog from '@/components/dashboard/FetchHostawayDialog';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';

export default function Dashboard() {
  const { user } = useAuth();
  const BUSINESS_ID = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const scopedFilter = (extra = {}) => userIsSystemAdmin ? extra : { ...extra, business_id: BUSINESS_ID };
  const defaultPeriod = getCurrentPayPeriod();
  const [month, setMonth] = useState(defaultPeriod.month);
  const [number, setNumber] = useState(defaultPeriod.number);
  const [fetchDialogOpen, setFetchDialogOpen] = useState(false);

  const { data: payoutItems = [] } = useQuery({
    queryKey: ['payoutItems', BUSINESS_ID, userIsSystemAdmin, month, number],
    enabled: Boolean(user) && (userIsSystemAdmin || Boolean(BUSINESS_ID)),
    queryFn: () => base44.entities.PayoutItem.filter(scopedFilter({ payout_run_id: `${month}-${number}` })),
    initialData: [],
  });

  const { data: matchResults = [] } = useQuery({
    queryKey: ['matchResults', BUSINESS_ID, userIsSystemAdmin, month, number],
    enabled: Boolean(user) && (userIsSystemAdmin || Boolean(BUSINESS_ID)),
    queryFn: () => base44.entities.MatchResult.filter(scopedFilter({ pay_period_month: month, pay_period_number: number })),
    initialData: [],
  });

  const { data: allPayoutItems = [] } = useQuery({
    queryKey: ['allPayoutItems', BUSINESS_ID, userIsSystemAdmin],
    enabled: Boolean(user) && (userIsSystemAdmin || Boolean(BUSINESS_ID)),
    queryFn: () => userIsSystemAdmin
      ? base44.entities.PayoutItem.list('-created_date', 500)
      : base44.entities.PayoutItem.filter({ business_id: BUSINESS_ID }, '-created_date', 500),
    initialData: [],
  });

  const totalCleanerPayouts = allPayoutItems.reduce((sum, i) => sum + (i.amount || 0), 0);
  const cleaningPayouts = allPayoutItems.filter(i => i.fee_type === 'Cleaning Fee').reduce((sum, i) => sum + (i.amount || 0), 0);
  const petPayouts = allPayoutItems.filter(i => i.fee_type === 'Pet Fee').reduce((sum, i) => sum + (i.amount || 0), 0);
  const manualPayouts = allPayoutItems.filter(i => i.fee_type === 'Manual').reduce((sum, i) => sum + (i.amount || 0), 0);

  const matched = matchResults.filter(r => r.match_status === 'Matched' || r.match_status === 'Ready for Payout').length;
  const missingQbo = matchResults.filter(r => r.match_status === 'Missing QBO Invoice').length;
  const missingTask = matchResults.filter(r => r.match_status === 'Missing Hostaway Task').length;
  const exceptions = matchResults.filter(r => !['Matched', 'Ready for Payout'].includes(r.match_status) && !r.resolved).length;

  const cleanerTotals = {};
  allPayoutItems.forEach(item => {
    if (!item.cleaner_name) return;
    cleanerTotals[item.cleaner_name] = (cleanerTotals[item.cleaner_name] || 0) + (item.amount || 0);
  });

  const fmt = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={getPayPeriodLabel(month, number)}
        actions={
          <PayPeriodSelector
            month={month}
            number={number}
            onMonthChange={setMonth}
            onNumberChange={setNumber}
          />
        }
      />

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        <Button
          onClick={() => setFetchDialogOpen(true)}
          className="h-auto py-3 flex flex-col gap-1.5 text-xs col-span-2 sm:col-span-1"
        >
          <RefreshCw className="w-4 h-4" />
          Fetch Hostaway Reservations & Tasks
        </Button>
        <Link to="/imports">
          <Button variant="outline" className="w-full h-auto py-3 flex flex-col gap-1.5 text-xs">
            <DollarSign className="w-4 h-4" />
            Upload QBO Revenue
          </Button>
        </Link>
        <Link to="/matching">
          <Button variant="outline" className="w-full h-auto py-3 flex flex-col gap-1.5 text-xs">
            <GitCompare className="w-4 h-4" />
            Run Matching
          </Button>
        </Link>
        <Link to="/export">
          <Button variant="outline" className="w-full h-auto py-3 flex flex-col gap-1.5 text-xs">
            <Download className="w-4 h-4" />
            Export Bills
          </Button>
        </Link>
      </div>

      {/* Payout Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Cleaner Payouts" value={fmt(totalCleanerPayouts)} icon={DollarSign} variant="primary" />
        <StatCard label="Cleaning Payouts" value={fmt(cleaningPayouts)} icon={ClipboardList} variant="default" />
        <StatCard label="Pet Cleaning Payouts" value={fmt(petPayouts)} icon={DollarSign} variant="default" />
        <StatCard label="Manual Payouts" value={fmt(manualPayouts)} icon={DollarSign} variant="default" />
      </div>

      {/* Matching Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard label="Matched Records" value={matched} icon={CheckCircle} variant="success" />
        <StatCard label="Missing QBO Invoices" value={missingQbo} icon={XCircle} variant="warning" />
        <StatCard label="Tasks No QBO Match" value={missingTask} icon={XCircle} variant="warning" />
        <StatCard label="QBO No Task" value={matchResults.filter(r => r.match_status === 'Missing Hostaway Task').length} icon={XCircle} variant="warning" />
        <StatCard label="Exceptions to Review" value={exceptions} icon={AlertTriangle} variant="danger" />
      </div>

      {/* Cleaner Totals */}
      {Object.keys(cleanerTotals).length > 0 && (
        <div className="bg-card rounded-xl border p-5">
          <h3 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">Total by Cleaner</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(cleanerTotals).sort((a, b) => b[1] - a[1]).map(([name, total]) => (
              <div key={name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-primary">{name.charAt(0)}</span>
                  </div>
                  <span className="text-sm font-medium">{name}</span>
                </div>
                <span className="text-sm font-bold">{fmt(total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <FetchHostawayDialog open={fetchDialogOpen} onClose={() => setFetchDialogOpen(false)} />

      {/* Empty State */}
      {allPayoutItems.length === 0 && matchResults.length === 0 && (
        <div className="bg-card rounded-xl border p-12 text-center mt-6">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Upload className="w-7 h-7 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Get Started</h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
            Upload your Hostaway Tasks, Reservations, and QBO Cleaner Revenue CSVs to begin calculating cleaner payouts.
          </p>
          <Link to="/imports">
            <Button>Upload CSV Files</Button>
          </Link>
        </div>
      )}
    </div>
  );
}