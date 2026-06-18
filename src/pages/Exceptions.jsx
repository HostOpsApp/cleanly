import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Check, X, Pencil } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import PayPeriodSelector from '@/components/shared/PayPeriodSelector';
import { getCurrentPayPeriod } from '@/lib/payPeriodUtils';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';


export default function Exceptions() {
  const { user } = useAuth();
  const BUSINESS_ID = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(BUSINESS_ID));
  const qc = useQueryClient();
  const defaultPeriod = getCurrentPayPeriod();
  const [month, setMonth] = useState(defaultPeriod.month);
  const [number, setNumber] = useState(defaultPeriod.number);
  const [selected, setSelected] = useState(null);

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['matchResults', BUSINESS_ID, userIsSystemAdmin, month, number],
    enabled: queryEnabled,
    queryFn: () => base44.entities.MatchResult.filter(userIsSystemAdmin ? {
      pay_period_month: month,
      pay_period_number: number,
    } : {
      business_id: BUSINESS_ID,
      pay_period_month: month,
      pay_period_number: number,
    }),
    initialData: [],
  });

  const { data: cleaners = [] } = useQuery({
    queryKey: ['cleaners', BUSINESS_ID, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Cleaner.filter({ active: true }, 'cleaner_name', 500)
      : base44.entities.Cleaner.filter({ business_id: BUSINESS_ID, active: true }, 'cleaner_name', 500),
    initialData: [],
  });

  const exceptions = results.filter(r =>
    !['Matched', 'Ready for Payout'].includes(r.match_status) && !r.resolved
  );

  const handleResolve = async (result, updates) => {
    await base44.entities.MatchResult.update(result.id, { ...updates, resolved: true });
    toast.success('Exception resolved');
    setSelected(null);
    qc.invalidateQueries({ queryKey: ['matchResults'] });
  };

  return (
    <div>
      <PageHeader
        title="Review Exceptions"
        description={`${exceptions.length} exceptions need review`}
        actions={
          <PayPeriodSelector month={month} number={number} onMonthChange={setMonth} onNumberChange={setNumber} />
        }
      />

      <div className="bg-card rounded-xl border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Res Key</TableHead>
              <TableHead>Listing</TableHead>
              <TableHead>Guest</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Exception Reason</TableHead>
              <TableHead>Recommended Action</TableHead>
              <TableHead>Amounts</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : exceptions.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <Check className="w-8 h-8 text-emerald-500" />
                  <span>No exceptions to review!</span>
                </div>
              </TableCell></TableRow>
            ) : exceptions.map((r) => (
              <TableRow key={r.id} className="hover:bg-muted/50">
                <TableCell className="font-mono text-xs">{r.normalized_reservation_key}</TableCell>
                <TableCell className="text-sm">{r.listing_name}</TableCell>
                <TableCell className="text-sm">{r.guest_name}</TableCell>
                <TableCell><StatusBadge status={r.match_status} /></TableCell>
                <TableCell className="text-xs text-destructive max-w-[200px]">{r.exception_reason}</TableCell>
                <TableCell className="text-xs max-w-[200px]">{r.recommended_action}</TableCell>
                <TableCell className="text-xs font-mono">
                  <div>Task: ${(r.task_cost || 0).toFixed(2)}</div>
                  <div>QBO: ${(r.qbo_amount || 0).toFixed(2)}</div>
                  <div>Expected: ${(r.expected_cleaning_cost || 0).toFixed(2)}</div>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => setSelected(r)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {selected && (
        <ExceptionResolveDialog
          result={selected}
          cleaners={cleaners}
          onResolve={handleResolve}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ExceptionResolveDialog({ result, cleaners, onResolve, onClose }) {
  const [action, setAction] = useState('');
  const [amount, setAmount] = useState(result.task_cost || result.qbo_amount || 0);
  const [cleanerId, setCleanerId] = useState(result.cleaner_id || '');
  const [notes, setNotes] = useState('');

  const actions = [
    { value: 'approve_recommended', label: 'Approve Recommended Payout' },
    { value: 'use_task_cost', label: 'Use Hostaway Task Cost' },
    { value: 'use_expected_rate', label: 'Use Expected Listing Rate' },
    { value: 'use_qbo_amount', label: 'Use QBO Amount' },
    { value: 'manual_override', label: 'Manual Override Amount' },
    { value: 'owner_stay', label: 'Mark as Owner Stay / No Invoice Expected' },
    { value: 'exclude', label: 'Exclude from Payout' },
  ];

  const handleSubmit = () => {
    let finalAmount = amount;
    let status = 'Ready for Payout';

    if (action === 'use_task_cost') finalAmount = result.task_cost || 0;
    if (action === 'use_expected_rate') finalAmount = result.expected_cleaning_cost || 0;
    if (action === 'use_qbo_amount') finalAmount = result.qbo_amount || 0;
    if (action === 'owner_stay') { status = 'Matched'; finalAmount = 0; }
    if (action === 'exclude') { status = 'Cancelled Task'; finalAmount = 0; }

    onResolve(result, {
      match_status: status,
      resolution_notes: `${action}: ${notes}`,
      cleaner_id: cleanerId,
      cleaner_name: cleaners.find(c => c.id === cleanerId)?.cleaner_name || result.cleaner_name,
      task_cost: finalAmount,
    });
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Resolve Exception</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="p-3 bg-muted/50 rounded-lg space-y-1 text-sm">
            <div><span className="text-muted-foreground">Reservation:</span> <span className="font-mono">{result.normalized_reservation_key}</span></div>
            <div><span className="text-muted-foreground">Listing:</span> {result.listing_name}</div>
            <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={result.match_status} /></div>
            <div><span className="text-muted-foreground">Reason:</span> <span className="text-destructive">{result.exception_reason}</span></div>
            <div className="grid grid-cols-3 gap-2 mt-2 font-mono text-xs">
              <div>Task: ${(result.task_cost || 0).toFixed(2)}</div>
              <div>QBO: ${(result.qbo_amount || 0).toFixed(2)}</div>
              <div>Expected: ${(result.expected_cleaning_cost || 0).toFixed(2)}</div>
            </div>
          </div>

          <div>
            <Label>Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose action" /></SelectTrigger>
              <SelectContent>
                {actions.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {action === 'manual_override' && (
            <div>
              <Label>Override Amount</Label>
              <Input type="number" step="0.01" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="mt-1" />
            </div>
          )}

          <div>
            <Label>Assign Cleaner</Label>
            <Select value={cleanerId} onValueChange={setCleanerId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select cleaner" /></SelectTrigger>
              <SelectContent>
                {cleaners.map(c => <SelectItem key={c.id} value={c.id}>{c.cleaner_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1" rows={2} />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={!action} className="flex-1">
              <Check className="w-4 h-4 mr-2" />Save Resolution
            </Button>
            <Button variant="outline" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}