import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import StatusBadge from '@/components/shared/StatusBadge';
import { Lock } from 'lucide-react';

export default function PayoutRunList({ runs, payoutItems, isLoading }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run Name</TableHead>
          <TableHead>Period</TableHead>
          <TableHead>Date Range</TableHead>
          <TableHead>Total Amount</TableHead>
          <TableHead>Items</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
        ) : runs.length === 0 ? (
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No payout runs yet.</TableCell></TableRow>
        ) : runs.map((r) => {
          const itemCount = payoutItems.filter(i => i.payout_run_id === r.id).length;
          const locked = r.locked || r.status === 'Approved' || r.status === 'Exported';
          return (
            <TableRow key={r.id}>
              <TableCell className="font-medium flex items-center gap-2">
                {r.run_name}
                {locked && <Lock className="w-3.5 h-3.5 text-destructive" />}
              </TableCell>
              <TableCell className="font-mono text-xs">{r.pay_period_month}-{r.pay_period_number}</TableCell>
              <TableCell className="text-sm">{r.start_date} → {r.end_date}</TableCell>
              <TableCell className="font-mono font-semibold">${(r.total_amount || 0).toFixed(2)}</TableCell>
              <TableCell>{itemCount}</TableCell>
              <TableCell><StatusBadge status={r.status} /></TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {r.created_date ? format(new Date(r.created_date), 'MMM d, HH:mm') : ''}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}