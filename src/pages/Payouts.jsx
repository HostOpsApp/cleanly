import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getBusinessId, isSystemAdmin, canManageBusiness } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import PageHeader from '@/components/shared/PageHeader';
import PayPeriodSelector from '@/components/shared/PayPeriodSelector';
import { getCurrentPayPeriod } from '@/lib/payPeriodUtils';
import { toast } from 'sonner';
import { Plus, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import PayoutRunList from '@/components/payouts/PayoutRunList';
import PayoutItemsTable from '@/components/payouts/PayoutItemsTable';
import PayoutFinalReview from '@/components/payouts/PayoutFinalReview';
import CreatePayoutRunDialog from '@/components/payouts/CreatePayoutRunDialog';
import PayoutItemDialog from '@/components/payouts/PayoutItemDialog';
import { generateBillNumber, getPayPeriodDates } from '@/lib/payPeriodUtils';

export default function Payouts() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const isAdmin = canManageBusiness(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const defaultPeriod = getCurrentPayPeriod();
  const [month, setMonth] = useState(defaultPeriod.month);
  const [number, setNumber] = useState(defaultPeriod.number);
  const [createRunOpen, setCreateRunOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [activeTab, setActiveTab] = useState('items');

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['payoutRuns', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.PayoutRun.list('-created_date', 50)
      : base44.entities.PayoutRun.filter({ business_id: businessId }, '-created_date', 50),
    initialData: [],
  });

  const { data: payoutItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['payoutItems', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.PayoutItem.list('-created_date', 1000)
      : base44.entities.PayoutItem.filter({ business_id: businessId }, '-created_date', 1000),
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

  const { data: listings = [] } = useQuery({
    queryKey: ['listings', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Listing.list('listing_name', 200)
      : base44.entities.Listing.filter({ business_id: businessId }, 'listing_name', 200),
    initialData: [],
  });

  // Current period's run
  const currentRun = runs.find(
    r => r.pay_period_month === month && r.pay_period_number === number
  );

  // Items for this period
  const periodItems = payoutItems.filter(i => i.payout_run_id === currentRun?.id);

  const isLocked = currentRun?.status === 'Approved' || currentRun?.status === 'Exported' || currentRun?.locked;
  const isLockedForNonAdmin = isLocked && !isAdmin;

  const handleCreateItem = () => {
    if (isLockedForNonAdmin) { toast.error('Period is locked. Contact an Admin.'); return; }
    setEditingItem(null);
    setItemDialogOpen(true);
  };

  const handleEditItem = (item) => {
    if (isLockedForNonAdmin) { toast.error('Period is locked. Contact an Admin.'); return; }
    setEditingItem(item);
    setItemDialogOpen(true);
  };

  const handleDuplicateItem = async (item) => {
    if (isLockedForNonAdmin) { toast.error('Period is locked. Contact an Admin.'); return; }
    const cleaner = cleaners.find(c => c.id === item.cleaner_id);
    const newItem = {
      ...item,
      id: undefined,
      source: 'Duplicate',
      is_duplicate_of: item.id,
      duplicate_check_status: 'Possible Duplicate',
      status: 'Needs Review',
      notes: `Duplicated from item ${item.id?.slice(-6)} — ${item.description || ''}`,
      bill_number: cleaner ? generateBillNumber(cleaner.cleaner_code, month, number) : item.bill_number,
    };
    delete newItem.id;
    delete newItem.created_date;
    delete newItem.updated_date;
    await base44.entities.PayoutItem.create(newItem);
    qc.invalidateQueries({ queryKey: ['payoutItems'] });
    toast.success('Duplicated — marked as Needs Review');
  };

  const handleDeleteItem = async (itemId) => {
    if (isLockedForNonAdmin) { toast.error('Period is locked. Contact an Admin.'); return; }
    if (!confirm('Delete this payout line?')) return;
    await base44.entities.PayoutItem.delete(itemId);
    qc.invalidateQueries({ queryKey: ['payoutItems'] });
    toast.success('Deleted');
  };

  const handleSaveItem = async (data) => {
    if (editingItem?.id) {
      await base44.entities.PayoutItem.update(editingItem.id, data);
      toast.success('Payout line updated');
    } else {
      const cleaner = cleaners.find(c => c.id === data.cleaner_id);
      await base44.entities.PayoutItem.create({
        ...data,
        ...(businessId ? { business_id: businessId } : {}),
        payout_run_id: currentRun?.id || null,
        source: data.source || 'Manual',
        status: data.status || 'Draft',
        bill_number: cleaner ? generateBillNumber(cleaner.cleaner_code, month, number) : '',
      });
      toast.success('Payout line added');
    }
    qc.invalidateQueries({ queryKey: ['payoutItems'] });
    setItemDialogOpen(false);
    setEditingItem(null);
  };

  const handleApproveFinal = async () => {
    if (!currentRun) { toast.error('No payout run for this period.'); return; }

    // Check for unreviewed duplicates
    const unreviewedDuplicates = periodItems.filter(
      i => i.duplicate_check_status === 'Possible Duplicate' || i.duplicate_check_status === 'Needs Review'
    );
    if (unreviewedDuplicates.length > 0) {
      toast.error(`Cannot approve — ${unreviewedDuplicates.length} possible duplicate(s) need review first.`);
      setActiveTab('review');
      return;
    }

    if (!confirm(`Finalize and lock payout run "${currentRun.run_name}"? This will prevent non-admin edits.`)) return;

    const totalAmount = periodItems
      .filter(i => i.include_in_final_payout !== false && i.status !== 'Excluded')
      .reduce((s, i) => s + (i.amount || 0), 0);

    await base44.entities.PayoutRun.update(currentRun.id, {
      status: 'Approved',
      locked: true,
      final_approved: true,
      final_approved_by: user?.full_name || user?.email || 'Admin',
      final_approved_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      total_amount: totalAmount,
    });

    // Mark all draft/ready items as approved
    const toApprove = periodItems.filter(i => i.status === 'Draft' || i.status === 'Ready');
    for (let i = 0; i < toApprove.length; i += 20) {
      await Promise.all(
        toApprove.slice(i, i + 20).map(item =>
          base44.entities.PayoutItem.update(item.id, {
            status: 'Approved',
            final_approved: true,
            final_approved_by: user?.full_name || user?.email || 'Admin',
            final_approved_at: new Date().toISOString(),
          })
        )
      );
    }

    qc.invalidateQueries();
    toast.success('Payout finalized and locked!');
    setActiveTab('items');
  };

  const handleUnlock = async () => {
    if (!isAdmin) { toast.error('Admin access required.'); return; }
    if (!currentRun) return;
    if (!confirm('Unlock this payout run? Non-admins will be able to edit data again.')) return;
    await base44.entities.PayoutRun.update(currentRun.id, {
      status: 'In Review',
      locked: false,
      final_approved: false,
    });
    qc.invalidateQueries();
    toast.success('Payout run unlocked');
  };

  const handleCreateRun = async ({ runName }) => {
    const dates = getPayPeriodDates(month, number);
    if (!userIsSystemAdmin && !businessId) { toast.error('Missing business ID — your user account is not linked to a business.'); return; }

    const run = await base44.entities.PayoutRun.create({
      ...(businessId ? { business_id: businessId } : {}),
      pay_period_month: month,
      pay_period_number: number,
      run_name: runName || `Payout Run ${month}-${number}`,
      start_date: dates.start,
      end_date: dates.end,
      status: 'Draft',
    });

    // Auto-populate from match results
    const [results, allCleaners, settings] = await Promise.all([
      userIsSystemAdmin ? base44.entities.MatchResult.filter({ pay_period_month: month, pay_period_number: number }, '-created_date', 500) : base44.entities.MatchResult.filter({ business_id: businessId, pay_period_month: month, pay_period_number: number }, '-created_date', 500),
      userIsSystemAdmin ? base44.entities.Cleaner.list('cleaner_name', 100) : base44.entities.Cleaner.filter({ business_id: businessId }, 'cleaner_name', 100),
      userIsSystemAdmin ? base44.entities.AppSetting.list() : base44.entities.AppSetting.filter({ business_id: businessId }),
    ]);

    const getSettingVal = (key, def) => {
      const s = settings.find(s => s.setting_key === key);
      return s ? parseFloat(s.setting_value) : def;
    };
    const diffThreshold = getSettingVal('cleaning_fee_diff_threshold', 5.00);
    const diffTolerance = getSettingVal('cleaning_fee_diff_tolerance', 5.10);
    const petPct = getSettingVal('pet_fee_payout_pct', 50);

    const readyResults = results.filter(r =>
      r.match_status === 'Ready for Payout' || (r.resolved && r.match_status !== 'Cancelled Task')
    );

    const cleanerMap = {};
    allCleaners.forEach(c => { cleanerMap[c.id] = c; });

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
        if (r.task_cost > r.qbo_amount && r.qbo_amount > 0) {
          payAmount = r.qbo_amount; source = 'QBO';
        } else if ((r.qbo_amount - r.task_cost) > diffTolerance) {
          payAmount = r.qbo_amount - diffThreshold; source = 'QBO';
        }
      }
      items.push({
        ...(businessId ? { business_id: businessId } : {}),
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

    if (results.length === 0) toast.warning('No match results found. Run Matching first.');
    else toast.success(`Created run with ${items.length} payout items ($${totalAmount.toFixed(2)})`);

    qc.invalidateQueries();
    setCreateRunOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Payout Management"
        description={currentRun ? `${currentRun.run_name} — ${periodItems.length} items` : 'Select or create a payout run'}
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <PayPeriodSelector month={month} number={number} onMonthChange={setMonth} onNumberChange={setNumber} />
            {currentRun && isLocked && isAdmin && (
              <Button variant="outline" size="sm" onClick={handleUnlock}>Unlock Period</Button>
            )}
            {currentRun && !isLocked && (
              <>
                <Button variant="outline" size="sm" onClick={handleCreateItem}>
                  <Plus className="w-4 h-4 mr-1" />Add Line
                </Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setActiveTab('review')}>
                  <ShieldCheck className="w-4 h-4 mr-1" />Final Review
                </Button>
              </>
            )}
            {!currentRun && (
              <Button onClick={() => setCreateRunOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />New Run
              </Button>
            )}
          </div>
        }
      />

      {!currentRun ? (
        <div className="bg-card rounded-xl border">
          <PayoutRunList runs={runs} payoutItems={payoutItems} isLoading={runsLoading} />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="items">Payout Lines ({periodItems.length})</TabsTrigger>
            <TabsTrigger value="runs">All Runs</TabsTrigger>
            <TabsTrigger value="review">Final Review</TabsTrigger>
          </TabsList>

          <TabsContent value="items">
            <PayoutItemsTable
              items={periodItems}
              cleaners={cleaners}
              listings={listings}
              isLocked={isLockedForNonAdmin}
              isAdmin={isAdmin}
              currentRun={currentRun}
              onEdit={handleEditItem}
              onDelete={handleDeleteItem}
              onDuplicate={handleDuplicateItem}
            />
          </TabsContent>

          <TabsContent value="runs">
            <PayoutRunList runs={runs} payoutItems={payoutItems} isLoading={runsLoading} />
          </TabsContent>

          <TabsContent value="review">
            <PayoutFinalReview
              items={periodItems}
              currentRun={currentRun}
              isLocked={isLockedForNonAdmin}
              isAdmin={isAdmin}
              onApproveFinal={handleApproveFinal}
              onUpdateItem={async (itemId, data) => {
                await base44.entities.PayoutItem.update(itemId, data);
                qc.invalidateQueries({ queryKey: ['payoutItems'] });
              }}
            />
          </TabsContent>
        </Tabs>
      )}

      <CreatePayoutRunDialog
        open={createRunOpen}
        onOpenChange={setCreateRunOpen}
        month={month}
        number={number}
        onMonthChange={setMonth}
        onNumberChange={setNumber}
        onConfirm={handleCreateRun}
      />

      <PayoutItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        item={editingItem}
        cleaners={cleaners}
        listings={listings}
        onSave={handleSaveItem}
      />
    </div>
  );
}