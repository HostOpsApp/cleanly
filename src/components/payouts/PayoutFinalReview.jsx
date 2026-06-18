import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, AlertTriangle, Lock, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';

const DUP_STATUSES = [
  { value: 'Approved as Valid', label: 'Approve as Valid', icon: CheckCircle2, color: 'text-emerald-600' },
  { value: 'Excluded', label: 'Exclude from Payout', icon: XCircle, color: 'text-destructive' },
  { value: 'Needs Review', label: 'Needs More Review', icon: HelpCircle, color: 'text-amber-600' },
];

function CleanerGroup({ cleanerName, items }) {
  const total = items.filter(i => i.include_in_final_payout !== false && i.status !== 'Excluded').reduce((s, i) => s + (i.amount || 0), 0);
  return (
    <div className="bg-card rounded-xl border overflow-hidden mb-3">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
        <span className="font-semibold text-sm">{cleanerName}</span>
        <span className="text-sm font-mono font-semibold text-emerald-700">${total.toFixed(2)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="text-left p-2">Property</th>
              <th className="text-left p-2">Description</th>
              <th className="text-left p-2">Source</th>
              <th className="text-left p-2">Checkout</th>
              <th className="text-right p-2">Amount</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Included</th>
            </tr>
          </thead>
          <tbody>
            {[...items].sort((a, b) => (a.checkout_date || '').localeCompare(b.checkout_date || '')).map(item => (
              <tr key={item.id} className={`border-b last:border-0 ${item.status === 'Excluded' || item.include_in_final_payout === false ? 'opacity-40' : ''}`}>
                <td className="p-2">{item.listing_name || '—'}</td>
                <td className="p-2 max-w-[180px] truncate" title={item.description}>{item.description || '—'}</td>
                <td className="p-2"><Badge variant="outline" className="text-xs">{item.source}</Badge></td>
                <td className="p-2 font-mono text-xs">{item.checkout_date || item.completion_date || '—'}</td>
                <td className="p-2 text-right font-mono font-semibold">${(item.amount || 0).toFixed(2)}</td>
                <td className="p-2"><span className="text-xs">{item.status}</span></td>
                <td className="p-2"><span className="text-xs">{item.include_in_final_payout !== false ? '✓' : '✗'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DuplicateReviewCard({ item, onResolve }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">{item.cleaner_name} — {item.listing_name || 'No listing'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
            <p className="text-xs text-muted-foreground">Source: <strong>{item.source}</strong> · Amount: <strong>${(item.amount || 0).toFixed(2)}</strong> · Checkout: {item.checkout_date || '—'}</p>
            {item.notes && <p className="text-xs text-amber-700 mt-1 italic">{item.notes}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {DUP_STATUSES.map(({ value, label, icon: Icon, color }) => (
            <Button
              key={value}
              variant="outline"
              size="sm"
              className={`text-xs gap-1 ${item.duplicate_check_status === value ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
              onClick={() => onResolve(item.id, value)}
            >
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function PayoutFinalReview({ items, currentRun, isLocked, isAdmin, onApproveFinal, onUpdateItem }) {
  const grouped = useMemo(() => {
    const map = {};
    for (const item of items) {
      const key = item.cleaner_name || '— Unassigned —';
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const possibleDupes = items.filter(
    i => i.duplicate_check_status === 'Possible Duplicate' || i.duplicate_check_status === 'Needs Review'
  );

  const unreviewedDupes = possibleDupes.filter(i => i.duplicate_check_status !== 'Approved as Valid' && i.duplicate_check_status !== 'Excluded');

  const grandTotal = items
    .filter(i => i.include_in_final_payout !== false && i.status !== 'Excluded')
    .reduce((s, i) => s + (i.amount || 0), 0);

  const handleResolveDuplicate = async (itemId, status) => {
    const updates = { duplicate_check_status: status };
    if (status === 'Excluded') {
      updates.status = 'Excluded';
      updates.include_in_final_payout = false;
    } else if (status === 'Approved as Valid') {
      updates.status = 'Ready';
      updates.include_in_final_payout = true;
    }
    await onUpdateItem(itemId, updates);
    toast.success(`Marked as: ${status}`);
  };

  const isApproved = currentRun?.status === 'Approved' || currentRun?.status === 'Exported' || currentRun?.final_approved;

  return (
    <div>
      {/* Summary */}
      <div className="flex items-center justify-between mb-5 p-4 bg-card rounded-xl border">
        <div>
          <p className="text-sm text-muted-foreground">Final Payout Total</p>
          <p className="text-2xl font-bold font-mono text-emerald-700">${grandTotal.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{items.filter(i => i.include_in_final_payout !== false && i.status !== 'Excluded').length} lines included · {grouped.length} cleaners</p>
        </div>
        <div className="text-right">
          {isApproved ? (
            <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-lg">
              <Lock className="w-4 h-4" />
              <div>
                <p className="font-semibold text-sm">Payout Finalized</p>
                {currentRun.final_approved_by && <p className="text-xs text-emerald-600">By {currentRun.final_approved_by}</p>}
              </div>
            </div>
          ) : (
            <Button
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onApproveFinal}
              disabled={unreviewedDupes.length > 0 || isLocked}
            >
              <ShieldCheck className="w-4 h-4 mr-2" />
              Approve Final Payout
            </Button>
          )}
          {unreviewedDupes.length > 0 && (
            <p className="text-xs text-destructive mt-1">Resolve {unreviewedDupes.length} duplicate(s) first</p>
          )}
        </div>
      </div>

      {/* Duplicate Review */}
      {possibleDupes.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Possible Duplicate Review ({possibleDupes.length})
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            The following items were flagged as possible duplicates. Review each one before approving the final payout.
          </p>
          {possibleDupes.map(item => (
            <DuplicateReviewCard key={item.id} item={item} onResolve={handleResolveDuplicate} />
          ))}
        </div>
      )}

      {/* Payout by Cleaner */}
      <h3 className="text-sm font-semibold mb-3">Final Payout by Cleaner</h3>
      {grouped.map(([name, groupItems]) => (
        <CleanerGroup key={name} cleanerName={name} items={groupItems} />
      ))}
      {grouped.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm bg-card rounded-xl border">
          No payout items for this period.
        </div>
      )}
    </div>
  );
}