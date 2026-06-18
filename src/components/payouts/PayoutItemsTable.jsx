import { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Trash2, Copy, Lock, AlertTriangle } from 'lucide-react';
import StatusBadge from '@/components/shared/StatusBadge';

const sourceColor = (source) => {
  if (source === 'QBO') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (source === 'Hostaway Task') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (source === 'Manual') return 'bg-purple-100 text-purple-700 border-purple-200';
  if (source === 'Duplicate') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (source === 'Adjustment') return 'bg-orange-100 text-orange-700 border-orange-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

export default function PayoutItemsTable({ items, cleaners, listings, isLocked, isAdmin, currentRun, onEdit, onDelete, onDuplicate }) {
  const [search, setSearch] = useState('');
  const [cleanerFilter, setCleanerFilter] = useState('all');

  const cleanerNames = useMemo(() => {
    const names = [...new Set(items.map(i => i.cleaner_name).filter(Boolean))].sort();
    return names;
  }, [items]);

  const filtered = useMemo(() => {
    let rows = items;
    if (cleanerFilter !== 'all') rows = rows.filter(i => i.cleaner_name === cleanerFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(i =>
        [i.cleaner_name, i.listing_name, i.description, i.normalized_reservation_key, i.confirmation_code, i.source, i.status, i.notes]
          .some(v => String(v || '').toLowerCase().includes(q))
      );
    }
    return [...rows].sort((a, b) => (a.cleaner_name || '').localeCompare(b.cleaner_name || '') || (a.checkout_date || '').localeCompare(b.checkout_date || ''));
  }, [items, search, cleanerFilter]);

  const totalIncluded = items.filter(i => i.include_in_final_payout !== false && i.status !== 'Excluded').reduce((s, i) => s + (i.amount || 0), 0);
  const possibleDupes = items.filter(i => i.duplicate_check_status === 'Possible Duplicate' || i.duplicate_check_status === 'Needs Review').length;

  return (
    <div>
      {possibleDupes > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 mb-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span><strong>{possibleDupes} possible duplicate(s)</strong> need review before final approval. Go to the Final Review tab.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input
          placeholder="Search cleaner, listing, description, key..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <select
          className="h-9 px-3 rounded-md border border-input bg-transparent text-sm"
          value={cleanerFilter}
          onChange={e => setCleanerFilter(e.target.value)}
        >
          <option value="all">All Cleaners</option>
          {cleanerNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} rows · Total included: <strong>${totalIncluded.toFixed(2)}</strong></span>
      </div>

      <div className="bg-card rounded-xl border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cleaner</TableHead>
              <TableHead>Property</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Res / Code</TableHead>
              <TableHead>Checkout</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Owner Bill</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Included</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No payout lines for this period.</TableCell></TableRow>
            ) : filtered.map(item => {
              const isDupe = item.duplicate_check_status === 'Possible Duplicate' || item.duplicate_check_status === 'Needs Review';
              const excluded = item.include_in_final_payout === false || item.status === 'Excluded';
              return (
                <TableRow
                  key={item.id}
                  className={excluded ? 'opacity-40 bg-slate-50' : isDupe ? 'bg-amber-50/40' : ''}
                >
                  <TableCell className="text-sm font-medium">{item.cleaner_name}</TableCell>
                  <TableCell className="text-sm">{item.listing_name || '—'}</TableCell>
                  <TableCell className="text-sm max-w-[160px] truncate" title={item.description}>{item.description || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={sourceColor(item.source)}>{item.source}</Badge>
                    {isDupe && <AlertTriangle className="w-3.5 h-3.5 text-amber-600 inline ml-1" />}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.confirmation_code || item.normalized_reservation_key || '—'}</TableCell>
                  <TableCell className="text-xs">{item.checkout_date || item.completion_date || '—'}</TableCell>
                  <TableCell className="font-mono text-sm font-semibold">${(item.amount || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-xs">
                    {item.billable_to_owner
                      ? <span className="text-orange-600 font-medium">${(item.owner_billable_amount || 0).toFixed(2)}</span>
                      : '—'}
                  </TableCell>
                  <TableCell><StatusBadge status={item.status} /></TableCell>
                  <TableCell>
                    {item.include_in_final_payout !== false
                      ? <span className="text-xs text-emerald-600 font-medium">Yes</span>
                      : <span className="text-xs text-muted-foreground">No</span>}
                  </TableCell>
                  <TableCell>
                    {isLocked ? (
                      <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => onEdit(item)} title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-amber-600" onClick={() => onDuplicate(item)} title="Duplicate">
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDelete(item.id)} title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}