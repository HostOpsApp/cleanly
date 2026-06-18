import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';

const COLORS = ['#4f6bed', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

export default function Reports() {
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const { data: payoutItems = [] } = useQuery({
    queryKey: ['allPayoutItems', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.PayoutItem.list('-created_date', 1000)
      : base44.entities.PayoutItem.filter({ business_id: businessId }, '-created_date', 1000),
    initialData: [],
  });

  const { data: matchResults = [] } = useQuery({
    queryKey: ['allMatchResults', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.MatchResult.list('-created_date', 1000)
      : base44.entities.MatchResult.filter({ business_id: businessId }, '-created_date', 1000),
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

  const { data: rates = [] } = useQuery({
    queryKey: ['allRates', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.ListingCleaningRate.list('-effective_date', 500)
      : base44.entities.ListingCleaningRate.filter({ business_id: businessId }, '-effective_date', 500),
    initialData: [],
  });

  // Payout Summary by Cleaner
  const cleanerSummary = {};
  payoutItems.forEach(item => {
    const name = item.cleaner_name || 'Unassigned';
    if (!cleanerSummary[name]) cleanerSummary[name] = { cleaning: 0, pet: 0, manual: 0, total: 0, count: 0 };
    cleanerSummary[name].total += item.amount || 0;
    cleanerSummary[name].count += 1;
    if (item.fee_type === 'Cleaning Fee') cleanerSummary[name].cleaning += item.amount || 0;
    if (item.fee_type === 'Pet Fee') cleanerSummary[name].pet += item.amount || 0;
    if (item.fee_type === 'Manual') cleanerSummary[name].manual += item.amount || 0;
  });

  const cleanerChartData = Object.entries(cleanerSummary).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.total - a.total);

  // Exception summary
  const exceptionSummary = {};
  matchResults.filter(r => !['Matched', 'Ready for Payout'].includes(r.match_status)).forEach(r => {
    exceptionSummary[r.match_status] = (exceptionSummary[r.match_status] || 0) + 1;
  });
  const exceptionChartData = Object.entries(exceptionSummary).map(([name, value]) => ({ name, value }));

  // Pet fee payouts
  const petItems = payoutItems.filter(i => i.fee_type === 'Pet Fee');

  // Owner billable items
  const ownerBillableItems = payoutItems.filter(i => i.fee_type === 'Owner Billable' || i.billable_to_owner === true);
  const ownerBillableTotal = ownerBillableItems.reduce((s, i) => s + (i.owner_billable_amount || i.amount || 0), 0);

  // Group owner billable by listing
  const ownerBillableByListing = {};
  ownerBillableItems.forEach(i => {
    const key = i.qbo_class || i.listing_name || 'Unknown';
    if (!ownerBillableByListing[key]) ownerBillableByListing[key] = { total: 0, count: 0 };
    ownerBillableByListing[key].total += (i.owner_billable_amount || i.amount || 0);
    ownerBillableByListing[key].count += 1;
  });

  // Current cleaning cost by listing
  const currentRates = {};
  listings.forEach(l => {
    const listingRates = rates.filter(r => r.listing_id === l.id).sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || ''));
    currentRates[l.id] = { listing: l, rate: listingRates[0] || null, allRates: listingRates };
  });

  const fmt = (n) => `$${(n || 0).toFixed(2)}`;

  return (
    <div>
      <PageHeader title="Reports" description="Payout analytics and data views" />

      <Tabs defaultValue="summary">
        <TabsList className="mb-4">
          <TabsTrigger value="summary">Payout Summary</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          <TabsTrigger value="pet">Pet Fees</TabsTrigger>
          <TabsTrigger value="rates">Cleaning Rates</TabsTrigger>
          <TabsTrigger value="variance">Fee Variance</TabsTrigger>
          <TabsTrigger value="owner">Owner Billable</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-card rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">Total by Cleaner</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={cleanerChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Bar dataKey="cleaning" fill="hsl(var(--primary))" name="Cleaning" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="pet" fill="hsl(var(--chart-4))" name="Pet" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="manual" fill="hsl(var(--chart-3))" name="Manual" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-card rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">Cleaner Detail</h3>
              <Table>
                <TableHeader><TableRow><TableHead>Cleaner</TableHead><TableHead>Items</TableHead><TableHead>Cleaning</TableHead><TableHead>Pet</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {cleanerChartData.map(c => (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.count}</TableCell>
                      <TableCell className="font-mono text-sm">{fmt(c.cleaning)}</TableCell>
                      <TableCell className="font-mono text-sm">{fmt(c.pet)}</TableCell>
                      <TableCell className="font-mono font-semibold">{fmt(c.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="exceptions">
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-card rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">Exception Types</h3>
              {exceptionChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={exceptionChartData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                      {exceptionChartData.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-muted-foreground py-12">No exceptions to show.</p>}
            </div>
            <div className="bg-card rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">Exception List</h3>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {matchResults.filter(r => !['Matched', 'Ready for Payout'].includes(r.match_status)).slice(0, 50).map(r => (
                  <div key={r.id} className="p-3 rounded-lg bg-muted/50 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs">{r.normalized_reservation_key}</span>
                      <StatusBadge status={r.match_status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{r.exception_reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pet">
          <div className="bg-card rounded-xl border overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Cleaner</TableHead><TableHead>Listing</TableHead><TableHead>Res Key</TableHead><TableHead>QBO Amount</TableHead><TableHead>Payout</TableHead></TableRow></TableHeader>
              <TableBody>
                {petItems.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No pet fee payouts.</TableCell></TableRow>
                ) : petItems.map(i => (
                  <TableRow key={i.id}>
                    <TableCell>{i.cleaner_name}</TableCell>
                    <TableCell>{i.listing_name}</TableCell>
                    <TableCell className="font-mono text-xs">{i.normalized_reservation_key}</TableCell>
                    <TableCell className="font-mono">{fmt(i.amount * 2)}</TableCell>
                    <TableCell className="font-mono font-semibold">{fmt(i.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="rates">
          <div className="bg-card rounded-xl border overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>Current Rate</TableHead><TableHead>Effective Date</TableHead><TableHead>Type</TableHead><TableHead>History Count</TableHead></TableRow></TableHeader>
              <TableBody>
                {Object.values(currentRates).map(({ listing, rate, allRates }) => (
                  <TableRow key={listing.id}>
                    <TableCell className="font-medium">{listing.listing_name}</TableCell>
                    <TableCell className="font-mono font-semibold">{rate ? fmt(rate.cleaning_cost) : '—'}</TableCell>
                    <TableCell className="text-sm">{rate?.effective_date || '—'}</TableCell>
                    <TableCell className="text-sm">{rate?.rate_type || '—'}</TableCell>
                    <TableCell>{allRates.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="variance">
          <div className="bg-card rounded-xl border overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Res Key</TableHead><TableHead>Listing</TableHead><TableHead>Task Cost</TableHead><TableHead>QBO Fee</TableHead><TableHead>Expected Rate</TableHead><TableHead>Variance</TableHead></TableRow></TableHeader>
              <TableBody>
                {matchResults.filter(r => r.fee_type === 'Cleaning Fee' && (r.qbo_amount || r.task_cost)).slice(0, 100).map(r => {
                  const variance = (r.qbo_amount || 0) - (r.task_cost || 0);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.normalized_reservation_key}</TableCell>
                      <TableCell className="text-sm">{r.listing_name}</TableCell>
                      <TableCell className="font-mono">{fmt(r.task_cost)}</TableCell>
                      <TableCell className="font-mono">{fmt(r.qbo_amount)}</TableCell>
                      <TableCell className="font-mono">{fmt(r.expected_cleaning_cost)}</TableCell>
                      <TableCell className={`font-mono font-semibold ${variance > 0 ? 'text-emerald-600' : variance < 0 ? 'text-destructive' : ''}`}>
                        {variance >= 0 ? '+' : ''}{fmt(variance)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        <TabsContent value="owner">
          <div className="grid lg:grid-cols-3 gap-6 mb-6">
            <div className="bg-card rounded-xl border p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Owner Billable</div>
              <div className="text-2xl font-mono font-bold text-destructive">{fmt(ownerBillableTotal)}</div>
              <div className="text-xs text-muted-foreground mt-1">{ownerBillableItems.length} item{ownerBillableItems.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="bg-card rounded-xl border p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider text-muted-foreground">By Property</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(ownerBillableByListing).sort((a, b) => b[1].total - a[1].total).map(([name, data]) => (
                  <div key={name} className="bg-muted rounded-lg px-3 py-2 text-sm">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground ml-2 font-mono">{fmt(data.total)}</span>
                    <span className="text-xs text-muted-foreground ml-1">({data.count})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Property / Class</TableHead>
                  <TableHead>Res Key</TableHead>
                  <TableHead>Checkout</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Fee Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ownerBillableItems.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No owner billable items.</TableCell></TableRow>
                ) : ownerBillableItems.sort((a, b) => (a.checkout_date || '').localeCompare(b.checkout_date || '')).map(i => (
                  <TableRow key={i.id}>
                    <TableCell className="text-sm">{i.cleaner_name || '—'}</TableCell>
                    <TableCell className="text-sm">{i.qbo_class || i.listing_name || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{i.normalized_reservation_key || '—'}</TableCell>
                    <TableCell className="text-sm font-mono">{i.checkout_date || '—'}</TableCell>
                    <TableCell className="text-sm">{i.owner_billable_description || i.description || '—'}</TableCell>
                    <TableCell className="text-sm">{i.fee_type}</TableCell>
                    <TableCell className="font-mono font-semibold text-right text-destructive">{fmt(i.owner_billable_amount || i.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

      </Tabs>
    </div>
  );
}