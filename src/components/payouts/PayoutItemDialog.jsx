import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

const STATUSES = ['Draft', 'Needs Review', 'Ready', 'Approved', 'Excluded'];
const FEE_TYPES = ['Cleaning Fee', 'Pet Fee', 'Manual', 'Adjustment', 'Owner Billable'];
const SOURCES = ['QBO', 'Hostaway Task', 'Listing Rate', 'Manual', 'Duplicate', 'Adjustment'];

const EMPTY = {
  cleaner_id: '',
  listing_id: '',
  listing_name: '',
  description: '',
  amount: '',
  fee_type: 'Cleaning Fee',
  source: 'Manual',
  status: 'Draft',
  cleaning_date: '',
  completion_date: '',
  checkout_date: '',
  billable_to_owner: false,
  owner_billable_amount: '',
  owner_billable_description: '',
  include_in_final_payout: true,
  notes: '',
  normalized_reservation_key: '',
  confirmation_code: '',
};

export default function PayoutItemDialog({ open, onOpenChange, item, cleaners, listings, onSave }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) setForm({ ...EMPTY, ...item });
    else setForm(EMPTY);
  }, [item, open]);

  const set = (field, val) => setForm(p => ({ ...p, [field]: val }));

  const handleSave = async () => {
    if (!form.cleaner_id) { alert('Please select a cleaner.'); return; }
    if (!form.amount || isNaN(parseFloat(form.amount))) { alert('Please enter a valid payout amount.'); return; }
    setSaving(true);
    const cleanerName = cleaners.find(c => c.id === form.cleaner_id)?.cleaner_name || '';
    const listing = listings.find(l => l.id === form.listing_id);
    const listingName = listing?.listing_name || form.listing_name || '';
    const qboClass = listing?.qbo_class_name || form.qbo_class || '';
    await onSave({
      ...form,
      amount: parseFloat(form.amount),
      owner_billable_amount: form.owner_billable_amount ? parseFloat(form.owner_billable_amount) : null,
      cleaner_name: cleanerName,
      listing_name: listingName,
      qbo_class: qboClass,
    });
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Payout Line' : 'Add Manual Payout Line'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div>
            <Label className="text-xs">Cleaner *</Label>
            <Select value={form.cleaner_id} onValueChange={v => set('cleaner_id', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select cleaner" /></SelectTrigger>
              <SelectContent>
                {cleaners.map(c => <SelectItem key={c.id} value={c.id}>{c.cleaner_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Property Class</Label>
            <Select
              value={form.listing_id || ''}
              onValueChange={v => {
                const listing = listings.find(l => l.id === v);
                set('listing_id', v);
                set('listing_name', listing?.listing_name || '');
                set('qbo_class', listing?.qbo_class_name || '');
              }}
            >
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select property class" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>— None —</SelectItem>
                {listings.map(l => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.qbo_class_name || l.listing_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.qbo_class && <p className="text-xs text-muted-foreground mt-1">Class: {form.qbo_class}</p>}
          </div>

          <div className="col-span-2">
            <Label className="text-xs">Description</Label>
            <Input className="mt-1" value={form.description || ''} onChange={e => set('description', e.target.value)} placeholder="e.g. Post-checkout clean, Pet cleaning, Repair" />
          </div>

          <div>
            <Label className="text-xs">Payout Amount ($) *</Label>
            <Input className="mt-1" type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Fee Type</Label>
            <Select value={form.fee_type} onValueChange={v => set('fee_type', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{FEE_TYPES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Source</Label>
            <Select value={form.source || 'Manual'} onValueChange={v => set('source', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Status</Label>
            <Select value={form.status || 'Draft'} onValueChange={v => set('status', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Cleaning / Start Date</Label>
            <Input className="mt-1" type="date" value={form.cleaning_date || ''} onChange={e => set('cleaning_date', e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Completion Date</Label>
            <Input className="mt-1" type="date" value={form.completion_date || ''} onChange={e => set('completion_date', e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Checkout Date</Label>
            <Input className="mt-1" type="date" value={form.checkout_date || ''} onChange={e => set('checkout_date', e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Reservation / Confirmation Code</Label>
            <Input className="mt-1" value={form.confirmation_code || form.normalized_reservation_key || ''} onChange={e => set('confirmation_code', e.target.value)} placeholder="Optional" />
          </div>

          {/* Billable to Owner Section */}
          <div className="col-span-2 border-t pt-3 mt-1">
            <div className="flex items-center gap-3 mb-3">
              <input
                type="checkbox"
                id="billable_to_owner"
                checked={!!form.billable_to_owner}
                onChange={e => set('billable_to_owner', e.target.checked)}
                className="w-4 h-4"
              />
              <Label htmlFor="billable_to_owner" className="text-sm font-medium cursor-pointer">Billable to Owner</Label>
            </div>
            {form.billable_to_owner && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Owner Billable Amount ($)</Label>
                  <Input className="mt-1" type="number" step="0.01" value={form.owner_billable_amount || ''} onChange={e => set('owner_billable_amount', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Owner Billable Description</Label>
                  <Input className="mt-1" value={form.owner_billable_description || ''} onChange={e => set('owner_billable_description', e.target.value)} placeholder="Reason for owner charge" />
                </div>
              </div>
            )}
          </div>

          <div className="col-span-2 flex items-center gap-3">
            <input
              type="checkbox"
              id="include_in_final_payout"
              checked={form.include_in_final_payout !== false}
              onChange={e => set('include_in_final_payout', e.target.checked)}
              className="w-4 h-4"
            />
            <Label htmlFor="include_in_final_payout" className="text-sm cursor-pointer">Include in Final Payout</Label>
          </div>

          <div className="col-span-2">
            <Label className="text-xs">Notes</Label>
            <Input className="mt-1" value={form.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Internal notes" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}