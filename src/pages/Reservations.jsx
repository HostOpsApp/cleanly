import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Table, TableBody, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/shared/PageHeader';
import PayPeriodSelector from '@/components/shared/PayPeriodSelector';
import { getCurrentPayPeriod } from '@/lib/payPeriodUtils';
import { SortableHead } from '@/components/shared/SortableHead';
import { usePeriodLock } from '@/hooks/usePeriodLock';
import PeriodLockBanner from '@/components/shared/PeriodLockBanner';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';

function checkoutMatchesPeriod(checkoutDate, month, number) {
  if (!checkoutDate) return false;
  const m = checkoutDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, y, mo, day] = m;
  return `${y}${mo}` === month && (parseInt(day) <= 14 ? '001' : '002') === number;
}

function sortRows(rows, field, dir) {
  return [...rows].sort((a, b) => {
    let va = a[field] ?? '';
    let vb = b[field] ?? '';
    if (typeof va === 'number' || typeof vb === 'number') {
      va = parseFloat(va) || 0; vb = parseFloat(vb) || 0;
      return dir === 'asc' ? va - vb : vb - va;
    }
    return dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });
}

export default function Reservations() {
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const defaultPeriod = getCurrentPayPeriod();
  const [month, setMonth] = useState(defaultPeriod.month);
  const [number, setNumber] = useState(defaultPeriod.number);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'check_out_date', dir: 'asc' });
  const { isLocked, isAdmin, isLockedForAdmin, lockedRun } = usePeriodLock(month, number);

  const toggleSort = (field) => setSort(prev =>
    prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }
  );

  const { data: reservations = [], isLoading } = useQuery({
    queryKey: ['reservations', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Reservation.list('-created_date', 2000)
      : base44.entities.Reservation.filter({ business_id: businessId }, '-created_date', 2000),
    initialData: [],
  });

  const filtered = useMemo(() => {
    let rows = reservations.filter(r => checkoutMatchesPeriod(r.check_out_date, month, number));
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        [r.reservation_id, r.normalized_reservation_key, r.listing_name, r.guest_name, r.channel, r.status]
          .some(v => String(v || '').toLowerCase().includes(q))
      );
    }
    return sortRows(rows, sort.field, sort.dir);
  }, [reservations, month, number, search, sort]);

  const sh = (label, field) => (
    <SortableHead label={label} field={field} sort={sort} onSort={toggleSort} />
  );

  return (
    <div>
      <PeriodLockBanner isLocked={isLocked} isAdmin={isAdmin} isLockedForAdmin={isLockedForAdmin} runName={lockedRun?.run_name} />
      <PageHeader
        title="Hostaway Reservations"
        description={`${filtered.length} of ${reservations.length} reservations`}
        actions={<PayPeriodSelector month={month} number={number} onMonthChange={setMonth} onNumberChange={setNumber} />}
      />
      <div className="mb-3">
        <Input
          placeholder="Search reservation ID, key, listing, guest, channel..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <div className="bg-card rounded-xl border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {sh('Res ID', 'reservation_id')}
              {sh('Normalized Key', 'normalized_reservation_key')}
              {sh('Listing', 'listing_name')}
              {sh('Guest', 'guest_name')}
              {sh('Check-in', 'check_in_date')}
              {sh('Check-out', 'check_out_date')}
              {sh('Created Date', 'reservation_created_date')}
              {sh('Cleaning Fee', 'cleaning_fee_value')}
              {sh('Pet Fee', 'pet_fee_value')}
              {sh('Channel', 'channel')}
              {sh('Status', 'status')}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
            ) : reservations.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">No reservations imported yet.</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">No reservations found for this period.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="border-b transition-colors hover:bg-muted/50">
                <td className="p-2 font-mono text-xs">{r.reservation_id}</td>
                <td className="p-2 font-mono text-xs font-semibold">{r.normalized_reservation_key}</td>
                <td className="p-2 text-sm">{r.listing_name}</td>
                <td className="p-2 text-sm">{r.guest_name}</td>
                <td className="p-2 text-xs">{r.check_in_date}</td>
                <td className="p-2 text-xs">{r.check_out_date}</td>
                <td className="p-2 text-xs font-semibold">{r.reservation_created_date}</td>
                <td className="p-2 font-mono text-sm">${(r.cleaning_fee_value || 0).toFixed(2)}</td>
                <td className="p-2 font-mono text-sm">${(r.pet_fee_value || 0).toFixed(2)}</td>
                <td className="p-2 text-xs">{r.channel}</td>
                <td className="p-2 text-xs">{r.status}</td>
              </tr>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}