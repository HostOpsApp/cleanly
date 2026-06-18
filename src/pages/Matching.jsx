import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GitCompare, Loader2, AlertTriangle, FileX, UserX, X } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PayPeriodSelector from '@/components/shared/PayPeriodSelector';
import { getCurrentPayPeriod, getPayPeriodDates } from '@/lib/payPeriodUtils';
import { toast } from 'sonner';

export default function Matching() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const scopedFilter = (extra = {}) => userIsSystemAdmin ? extra : { ...extra, business_id: businessId };
  const defaultPeriod = getCurrentPayPeriod();
  const [month, setMonth] = useState(defaultPeriod.month);
  const [number, setNumber] = useState(defaultPeriod.number);
  const [running, setRunning] = useState(false);
  const [actionLoading, setActionLoading] = useState({});

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['matchResults', businessId, userIsSystemAdmin, month, number],
    enabled: queryEnabled,
    queryFn: () => base44.entities.MatchResult.filter(scopedFilter({ pay_period_month: month, pay_period_number: number }), '-created_date', 500),
    initialData: [],
  });

  const runMatching = async () => {
    setRunning(true);
    try {
      if (!userIsSystemAdmin && !businessId) {
        toast.error('Missing business ID — your user account is not linked to a business.');
        setRunning(false);
        return;
      }

      const periodDates = getPayPeriodDates(month, number);

      const [allTasks, reservations, allQboLines, listings, rates, cleaners, settings] = await Promise.all([
        userIsSystemAdmin ? base44.entities.CleaningTask.list('-created_date', 1000) : base44.entities.CleaningTask.filter({ business_id: businessId }, '-created_date', 1000),
        userIsSystemAdmin ? base44.entities.Reservation.list('-created_date', 1000) : base44.entities.Reservation.filter({ business_id: businessId }, '-created_date', 1000),
        userIsSystemAdmin ? base44.entities.QboCleanerRevenueLine.list('-created_date', 1000) : base44.entities.QboCleanerRevenueLine.filter({ business_id: businessId }, '-created_date', 1000),
        userIsSystemAdmin ? base44.entities.Listing.list('listing_name', 200) : base44.entities.Listing.filter({ business_id: businessId }, 'listing_name', 200),
        userIsSystemAdmin ? base44.entities.ListingCleaningRate.list('-effective_date', 500) : base44.entities.ListingCleaningRate.filter({ business_id: businessId }, '-effective_date', 500),
        userIsSystemAdmin ? base44.entities.Cleaner.list('cleaner_name', 100) : base44.entities.Cleaner.filter({ business_id: businessId }, 'cleaner_name', 100),
        userIsSystemAdmin ? base44.entities.AppSetting.list() : base44.entities.AppSetting.filter({ business_id: businessId }),
      ]);

      // Filter to only records whose checkout date falls within this pay period
      const tasks = allTasks.filter(t => {
        const res = reservations.find(r => r.reservation_id === t.reservation_id);
        const checkoutDate = res?.check_out_date || '';
        return checkoutDate >= periodDates.start && checkoutDate <= periodDates.end;
      });

      const qboLines = allQboLines.filter(q => {
        const checkout = q.checkout_date || '';
        return checkout >= periodDates.start && checkout <= periodDates.end;
      });

      toast.info(`Period ${month}-${number}: ${tasks.length} tasks, ${qboLines.length} QBO lines in scope`);

      const getSettingVal = (key, def) => {
        const s = settings.find(s => s.setting_key === key);
        return s ? parseFloat(s.setting_value) : def;
      };
      const diffThreshold = getSettingVal('cleaning_fee_diff_threshold', 5.00);
      const diffTolerance = getSettingVal('cleaning_fee_diff_tolerance', 5.10);
      const petPct = getSettingVal('pet_fee_payout_pct', 50);

      // Save prior resolutions before deleting
      const priorResolutions = {};
      results.forEach(r => {
        if (r.resolved) {
          priorResolutions[`${r.normalized_reservation_key}||${r.fee_type || 'Cleaning Fee'}`] = {
            resolved: true,
            match_status: r.match_status,
            exception_reason: r.exception_reason,
            resolution_notes: r.resolution_notes,
          };
        }
      });

      // Delete old results for this period — parallel batches to avoid rate limits
      const oldResults = results;
      const deleteChunk = 5;
      for (let i = 0; i < oldResults.length; i += deleteChunk) {
        await Promise.all(oldResults.slice(i, i + deleteChunk).map(r => base44.entities.MatchResult.delete(r.id)));
        if (i + deleteChunk < oldResults.length) await new Promise(res => setTimeout(res, 200));
      }

      // Build lookup maps
      const resByKey = {};
      reservations.forEach(r => { if (r.normalized_reservation_key) resByKey[r.normalized_reservation_key] = r; });
      const qboByKey = {};
      qboLines.forEach(q => {
        const key = q.normalized_reservation_key || q.num;
        if (!qboByKey[key]) qboByKey[key] = [];
        qboByKey[key].push(q);
        // Also index by num directly for fallback
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
      // Sort rates by effective_date desc
      Object.keys(ratesByListing).forEach(k => {
        ratesByListing[k].sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || ''));
      });
      const cleanerByEmail = {};
      const cleanerByName = {};
      const cleanerById = {};
      cleaners.forEach(c => {
        if (c.email) cleanerByEmail[c.email.trim().toLowerCase()] = c;
        if (c.cleaner_name) cleanerByName[c.cleaner_name.trim().toLowerCase()] = c;
        cleanerById[c.id] = c;
      });

      // Update task normalized keys from reservations
      tasks.forEach(t => {
        if (t.reservation_id && resByKey[t.reservation_id]) {
          // Use reservation's better normalized key
        }
        const res = reservations.find(r => r.reservation_id === t.reservation_id);
        if (res && res.normalized_reservation_key) {
          t.normalized_reservation_key = res.normalized_reservation_key;
        } else {
          t.normalized_reservation_key = t.normalized_reservation_key || t.reservation_id || '';
        }
      });

      const findExpectedRate = (listingId, reservationCreatedDate) => {
        const listingRates = ratesByListing[listingId];
        if (!listingRates || listingRates.length === 0) return null;
        if (!reservationCreatedDate) return listingRates[0]; // fallback to most recent
        for (const rate of listingRates) {
          if (rate.effective_date <= reservationCreatedDate) return rate;
        }
        return null; // All rates are after reservation created date
      };

      const newResults = [];
      const processedKeys = new Set();

      // Process tasks
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
        // Extract email and name from assignee_user string (format: "First Last email@domain.com")
        const assigneeRaw = (task.assignee_user || '').trim();
        const assigneeEmailMatch = assigneeRaw.match(/\S+@\S+/);
        const assigneeEmail = assigneeEmailMatch ? assigneeEmailMatch[0].toLowerCase() : '';
        const assigneeName = assigneeRaw.replace(/\S+@\S+/g, '').trim().toLowerCase();
        const cleaner = (task.cleaner_id && cleanerById[task.cleaner_id])
          || cleanerByEmail[assigneeEmail]
          || cleanerByName[assigneeName]
          || (listing?.default_cleaner_id ? cleanerById[listing.default_cleaner_id] : null);

        // Determine match status and exceptions
        let matchStatus = 'Matched';
        let exceptionReason = '';
        let recommendedAction = '';

        if (task.status?.toLowerCase() === 'cancelled') {
          matchStatus = 'Cancelled Task';
          exceptionReason = 'Task is cancelled — do not pay unless manually approved';
        } else if (!qboCleaningLine && !qboPetLine) {
          matchStatus = 'Missing QBO Invoice';
          exceptionReason = 'No QBO invoice found for this reservation';
          recommendedAction = 'Check QBO for missing invoice or mark as owner stay';
        } else if (!cleaner) {
          matchStatus = 'Missing Cleaner';
          exceptionReason = 'No cleaner assigned to task or listing';
          recommendedAction = 'Assign a cleaner';
        } else if (!task.cost && task.cost !== 0) {
          matchStatus = 'Missing Task Cost';
          exceptionReason = 'Task has no cost assigned';
          recommendedAction = 'Use expected listing cleaning rate or set manually';
        } else if (expectedRate && task.cost !== expectedRate.cleaning_cost) {
          matchStatus = 'Cleaning Rate Exception';
          exceptionReason = `Task cost ($${task.cost}) does not match expected rate ($${expectedRate.cleaning_cost}) based on reservation created date`;
          recommendedAction = 'Review and choose correct amount';
        } else if (qboCleaningLine && task.cost > (qboCleaningLine.product_service_amount_line ?? qboCleaningLine.amount_line ?? 0)) {
          const qboAmt = qboCleaningLine.product_service_amount_line ?? qboCleaningLine.amount_line ?? 0;
          matchStatus = 'Amount Exception';
          exceptionReason = `Task cost ($${task.cost}) exceeds QBO cleaning fee ($${qboAmt})`;
          recommendedAction = 'Adjust / Review';
        } else if (qboCleaningLine && ((qboCleaningLine.product_service_amount_line ?? qboCleaningLine.amount_line ?? 0) - task.cost) > diffTolerance) {
          const qboAmt = qboCleaningLine.product_service_amount_line ?? qboCleaningLine.amount_line ?? 0;
          matchStatus = 'Amount Exception';
          exceptionReason = `QBO fee ($${qboAmt}) exceeds task cost ($${task.cost}) by more than $${diffTolerance}`;
          recommendedAction = `Pay cleaner $${(qboAmt - diffThreshold).toFixed(2)} (QBO fee minus $${diffThreshold})`;
        } else {
          matchStatus = 'Ready for Payout';
        }

        if (!listing) {
          exceptionReason = (exceptionReason ? exceptionReason + '; ' : '') + 'Listing not found in app';
          if (matchStatus === 'Matched' || matchStatus === 'Ready for Payout') matchStatus = 'Needs Review';
        }

        newResults.push({
          reservation_id: reservation?.reservation_id || task.reservation_id,
          normalized_reservation_key: key,
          task_id: task.id,
          qbo_line_id: qboCleaningLine?.id || '',
          listing_id: listing?.id || '',
          listing_name: task.listing_name || listing?.listing_name || '',
          guest_name: reservation?.guest_name || '',
          check_in_date: reservation?.check_in_date || '',
          checkout_date: reservation?.check_out_date || '',
          reservation_created_date: reservation?.reservation_created_date || '',
          cleaner_id: cleaner?.id || '',
          cleaner_name: cleaner?.cleaner_name || '',
          task_status: task.status || '',
          qbo_amount: qboCleaningLine?.product_service_amount_line ?? qboCleaningLine?.amount_line ?? 0,
          task_cost: task.cost || 0,
          expected_cleaning_cost: expectedRate?.cleaning_cost || 0,
          fee_type: 'Cleaning Fee',
          match_status: matchStatus,
          exception_reason: exceptionReason,
          recommended_action: recommendedAction,
          pay_period_month: month,
          pay_period_number: number,
        });

        // Handle pet fee line
        if (qboPetLine) {
          newResults.push({
            reservation_id: reservation?.reservation_id || task.reservation_id,
            normalized_reservation_key: key,
            task_id: task.id,
            qbo_line_id: qboPetLine.id,
            listing_id: listing?.id || '',
            listing_name: task.listing_name || listing?.listing_name || '',
            guest_name: reservation?.guest_name || '',
            check_in_date: reservation?.check_in_date || '',
            checkout_date: reservation?.check_out_date || '',
            reservation_created_date: reservation?.reservation_created_date || '',
            cleaner_id: cleaner?.id || '',
            cleaner_name: cleaner?.cleaner_name || '',
            task_status: task.status || '',
            qbo_amount: qboPetLine.product_service_amount_line ?? qboPetLine.amount_line ?? 0,
            task_cost: 0,
            expected_cleaning_cost: 0,
            fee_type: 'Pet Fee',
            match_status: cleaner ? 'Ready for Payout' : 'Missing Cleaner',
            exception_reason: cleaner ? '' : 'No cleaner assigned',
            recommended_action: cleaner ? `Pay cleaner ${petPct}% = $${((qboPetLine.product_service_amount_line ?? qboPetLine.amount_line ?? 0) * petPct / 100).toFixed(2)}` : 'Assign cleaner',
            pay_period_month: month,
            pay_period_number: number,
          });
        }
      }

      // Find QBO lines with no task
      for (const [key, lines] of Object.entries(qboByKey)) {
        if (processedKeys.has(key)) continue;
        for (const qboLine of lines) {
          const reservation = resByKey[key];
          newResults.push({
            reservation_id: reservation?.reservation_id || '',
            normalized_reservation_key: key,
            qbo_line_id: qboLine.id,
            listing_name: qboLine.qbo_class || '',
            guest_name: qboLine.guest || reservation?.guest_name || '',
            checkout_date: qboLine.checkout_date || reservation?.check_out_date || '',
            qbo_amount: qboLine.product_service_amount_line ?? qboLine.amount_line ?? 0,
            fee_type: qboLine.fee_type || 'Cleaning Fee',
            match_status: 'Missing Hostaway Task',
            exception_reason: 'QBO invoice line has no matching Hostaway task',
            recommended_action: 'Check for missing task or manual payout',
            pay_period_month: month,
            pay_period_number: number,
          });
        }
      }

      // Re-apply prior resolutions before saving
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

      // Bulk create MatchResult records in chunks with a small delay to avoid rate limits.
      const chunkSize = 20;
      for (let i = 0; i < newResults.length; i += chunkSize) {
        const chunk = newResults.slice(i, i + chunkSize).map(rec => ({
          ...rec,
          ...(businessId ? { business_id: businessId } : {}),
        }));

        await Promise.all(
          chunk.map(rec => base44.entities.MatchResult.create(rec))
        );

        if (i + chunkSize < newResults.length) {
          await new Promise(res => setTimeout(res, 300));
        }
      }

      const preserved = Object.keys(priorResolutions).length;
      toast.success(`Matching complete: ${newResults.length} results generated${preserved > 0 ? ` (${preserved} resolutions preserved)` : ''}`);
      qc.invalidateQueries({ queryKey: ['matchResults'] });
    } catch (err) {
      toast.error(`Matching failed: ${err.message}`);
    }
    setRunning(false);
  };

  // Section 1: Tasks missing a QBO line (show unresolved + resolved for context, Clear button removes resolved)
  const missingQbo = results.filter(r =>
    r.fee_type === 'Cleaning Fee' && (r.match_status === 'Missing QBO Invoice' || (r.resolved && r.exception_reason && !r.qbo_line_id))
  );

  // Section 2: Tasks where cost does NOT equal QBO amount minus $5
  const amountMismatch = results.filter(r => {
    if (r.fee_type !== 'Cleaning Fee') return false;
    if (!r.qbo_amount || r.match_status === 'Missing QBO Invoice') return false;
    const expected = r.qbo_amount - 5;
    return Math.abs((r.task_cost || 0) - expected) > 0.01;
  });

  // Section 3: Tasks with status "To Do" or "Done" but no cleaner assigned
  const noCleanerAssigned = results.filter(r => {
    const status = (r.task_status || '').toLowerCase();
    return (status === 'to do' || status === 'done') && !r.cleaner_name;
  });

  const applyMissingQboAction = async (result, action) => {
    setActionLoading(p => ({ ...p, [result.id]: true }));
    let updateData = {};
    if (action === 'owner_stay') {
      updateData = { match_status: 'Needs Review', exception_reason: 'Owner Stay — no QBO invoice expected', resolved: true };
    } else if (action === 'other_charge_owner') {
      updateData = { match_status: 'Needs Review', exception_reason: 'Other - Stay: Charge Owner', resolved: true };
    } else if (action === 'other_do_not_bill') {
      updateData = { match_status: 'Needs Review', exception_reason: 'Other - Do Not Bill Owner', resolved: true };
    } else if (action === 'pay_cleaner') {
      updateData = { match_status: 'Ready for Payout', exception_reason: 'Manually approved for payout — no QBO line required', resolved: true };
    }
    await base44.entities.MatchResult.update(result.id, updateData);
    qc.invalidateQueries({ queryKey: ['matchResults'] });
    setActionLoading(p => ({ ...p, [result.id]: false }));
    toast.success('Updated');
  };

  const clearResolved = async (rowsToRemove) => {
    setRunning(true);
    for (let i = 0; i < rowsToRemove.length; i += 5) {
      await Promise.all(rowsToRemove.slice(i, i + 5).map(r => base44.entities.MatchResult.delete(r.id)));
      if (i + 5 < rowsToRemove.length) await new Promise(res => setTimeout(res, 200));
    }
    qc.invalidateQueries({ queryKey: ['matchResults'] });
    setRunning(false);
    toast.success(`${rowsToRemove.length} items cleared`);
  };

  const SectionTable = ({ rows, columns, emptyText, showMissingQboActions = false, showClearButton = false }) => (
    <div>
      {showClearButton && rows.length > 0 && (
        <div className="flex justify-end mb-2">
          <Button size="sm" variant="outline" className="gap-1 text-xs text-muted-foreground" onClick={() => clearResolved(rows)} disabled={running}>
            <X className="w-3 h-3" />Clear All ({rows.length})
          </Button>
        </div>
      )}
      <div className="bg-card rounded-xl border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(c => <TableHead key={c}>{c}</TableHead>)}
              {showMissingQboActions && <TableHead>Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={columns.length + (showMissingQboActions ? 1 : 0)} className="text-center py-6 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={columns.length + (showMissingQboActions ? 1 : 0)} className="text-center py-6 text-emerald-600 font-medium">✓ {emptyText}</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id} className={r.resolved ? 'opacity-60' : ''}>
                <TableCell className="font-mono text-xs">{r.normalized_reservation_key}</TableCell>
                <TableCell className="text-sm">{r.listing_name}</TableCell>
                <TableCell className="text-sm">{r.guest_name}</TableCell>
                <TableCell className="text-xs font-mono">{r.check_in_date || '—'}</TableCell>
                <TableCell className="text-xs font-mono">{r.checkout_date || '—'}</TableCell>
                {columns.includes('Res. Created Date') && <TableCell className="text-xs font-mono">{r.reservation_created_date || '—'}</TableCell>}
                <TableCell className="text-sm">{r.cleaner_name || '—'}</TableCell>
                <TableCell className="text-sm">{r.task_status || '—'}</TableCell>
                {columns.includes('Task Cost') && <TableCell className="font-mono text-sm">${(r.task_cost || 0).toFixed(2)}</TableCell>}
                {columns.includes('QBO Amount') && <TableCell className="font-mono text-sm">${(r.qbo_amount || 0).toFixed(2)}</TableCell>}
                {columns.includes('Expected ($QBO - $5)') && <TableCell className="font-mono text-sm">${((r.qbo_amount || 0) - 5).toFixed(2)}</TableCell>}
                {columns.includes('Difference') && (
                  <TableCell className="font-mono text-sm text-destructive font-semibold">
                    ${Math.abs((r.task_cost || 0) - ((r.qbo_amount || 0) - 5)).toFixed(2)}
                  </TableCell>
                )}
                {showMissingQboActions && (
                  <TableCell>
                    {r.resolved ? (
                      <span className="text-xs text-muted-foreground italic">{r.exception_reason || 'Resolved'}</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Select onValueChange={(val) => applyMissingQboAction(r, val)} disabled={actionLoading[r.id]}>
                          <SelectTrigger className="h-7 text-xs w-52">
                            <SelectValue placeholder={actionLoading[r.id] ? 'Saving...' : 'Select action…'} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner_stay">Owner Stay</SelectItem>
                            <SelectItem value="other_charge_owner">Other - Stay Charge Owner</SelectItem>
                            <SelectItem value="other_do_not_bill">Other - Do Not Bill Owner</SelectItem>
                            <SelectItem value="pay_cleaner">Pay Cleaner</SelectItem>
                          </SelectContent>
                        </Select>
                        {actionLoading[r.id] && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Matching Engine"
        description="Review exceptions across tasks, QBO lines, and cleaner assignments"
        actions={
          <div className="flex items-center gap-3">
            <PayPeriodSelector month={month} number={number} onMonthChange={setMonth} onNumberChange={setNumber} />
            <Button onClick={runMatching} disabled={running}>
              {running ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running...</> : <><GitCompare className="w-4 h-4 mr-2" />Run Matching</>}
            </Button>
          </div>
        }
      />

      {/* Section 1: Missing QBO Line */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <FileX className="w-5 h-5 text-destructive" />
          <h2 className="text-lg font-semibold">Tasks Missing a QBO Line</h2>
          {missingQbo.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-bold">{missingQbo.length}</span>
          )}
        </div>
        <SectionTable
          rows={missingQbo}
          columns={['Res Key', 'Listing', 'Guest', 'Check-In', 'Check-Out', 'Cleaner', 'Task Status']}
          emptyText="All tasks have a matching QBO line"
          showMissingQboActions={true}
          showClearButton={true}
        />
      </div>

      {/* Section 2: Amount Mismatch */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-5 h-5 text-warning" />
          <h2 className="text-lg font-semibold">Task Cost ≠ QBO Amount − $5</h2>
          {amountMismatch.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-bold">{amountMismatch.length}</span>
          )}
        </div>
        <SectionTable
          rows={amountMismatch}
          columns={['Res Key', 'Listing', 'Guest', 'Check-In', 'Check-Out', 'Res. Created Date', 'Cleaner', 'Task Status', 'Task Cost', 'QBO Amount', 'Expected ($QBO - $5)', 'Difference']}
          emptyText="All task costs match QBO amount minus $5"
          showClearButton={true}
        />
      </div>

      {/* Section 3: No Cleaner Assigned */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <UserX className="w-5 h-5 text-orange-500" />
          <h2 className="text-lg font-semibold">Tasks with No Cleaner Assigned (To Do / Done)</h2>
          {noCleanerAssigned.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 text-xs font-bold">{noCleanerAssigned.length}</span>
          )}
        </div>
        <SectionTable
          rows={noCleanerAssigned}
          columns={['Res Key', 'Listing', 'Guest', 'Check-In', 'Check-Out', 'Cleaner', 'Task Status']}
          emptyText="All To Do / Done tasks have a cleaner assigned"
          showClearButton={true}
        />
      </div>
    </div>
  );
}