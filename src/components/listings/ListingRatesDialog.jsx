import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const rateTypes = ['Standard Cleaning', 'Deep Cleaning', 'Owner Stay', 'Pet Cleaning', 'Other'];

export default function ListingRatesDialog({ listingId, listings, cleaners, onClose }) {
  const qc = useQueryClient();
  const listing = listings.find(l => l.id === listingId);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ effective_date: '', cleaning_cost: '', cleaner_id: '', rate_type: 'Standard Cleaning', notes: '' });

  const { data: rates = [] } = useQuery({
    queryKey: ['listingRates', listingId],
    queryFn: () => base44.entities.ListingCleaningRate.filter({ listing_id: listingId }),
    initialData: [],
  });

  const sortedRates = [...rates].sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || ''));

  const handleAdd = async () => {
    if (!form.effective_date || !form.cleaning_cost) { toast.error('Date and cost required'); return; }
    await base44.entities.ListingCleaningRate.create({
      listing_id: listingId,
      effective_date: form.effective_date,
      cleaning_cost: parseFloat(form.cleaning_cost),
      cleaner_id: form.cleaner_id || undefined,
      rate_type: form.rate_type,
      notes: form.notes,
      active: true,
    });
    toast.success('Rate added');
    setShowAdd(false);
    setForm({ effective_date: '', cleaning_cost: '', cleaner_id: '', rate_type: 'Standard Cleaning', notes: '' });
    qc.invalidateQueries({ queryKey: ['listingRates', listingId] });
  };

  const handleDelete = async (id) => {
    await base44.entities.ListingCleaningRate.delete(id);
    toast.success('Rate removed');
    qc.invalidateQueries({ queryKey: ['listingRates', listingId] });
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cleaning Rate History — {listing?.listing_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">Rate is selected based on reservation created date, not check-in/out date.</p>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add Rate
            </Button>
          </div>

          {showAdd && (
            <div className="p-4 bg-muted/50 rounded-lg space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><Label className="text-xs">Effective Date *</Label><Input type="date" value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} className="mt-1" /></div>
                <div><Label className="text-xs">Cleaning Cost *</Label><Input type="number" step="0.01" value={form.cleaning_cost} onChange={e => setForm(f => ({ ...f, cleaning_cost: e.target.value }))} className="mt-1" /></div>
                <div>
                  <Label className="text-xs">Rate Type</Label>
                  <Select value={form.rate_type} onValueChange={v => setForm(f => ({ ...f, rate_type: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{rateTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Cleaner (optional)</Label>
                  <Select value={form.cleaner_id} onValueChange={v => setForm(f => ({ ...f, cleaner_id: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Any cleaner" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any</SelectItem>
                      {cleaners.map(c => <SelectItem key={c.id} value={c.id}>{c.cleaner_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" /></div>
              </div>
              <Button size="sm" onClick={handleAdd}>Save Rate</Button>
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRates.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">No rates defined.</TableCell></TableRow>
                ) : sortedRates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.effective_date}</TableCell>
                    <TableCell className="font-semibold">${(r.cleaning_cost || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-sm">{r.rate_type}</TableCell>
                    <TableCell className="text-sm">{cleaners.find(c => c.id === r.cleaner_id)?.cleaner_name || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.notes}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}