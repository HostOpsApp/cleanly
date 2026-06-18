import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Mail, Phone } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import CsvUploadButton from '@/components/shared/CsvUploadButton';
import { getBusinessId, canManageBusiness, isSystemAdmin } from '@/lib/roles';
import { toast } from 'sonner';

const emptyForm = {
  cleaner_name: '', qbo_vendor_name: '', cleaner_code: '', email: '',
  phone: '', mailing_address: '', active: true, default_expense_account: 'Contract labor:Rental Cleanings',
  hostaway_user_id: '', notes: '',
};

const CLEANER_TEMPLATE_HEADERS = ['cleaner_name','cleaner_code','email','phone','qbo_vendor_name','mailing_address','default_expense_account','hostaway_user_id','notes'];
const CLEANER_TEMPLATE_ROWS = [['Jane Smith','JANE','jane@example.com','555-1234','Jane Smith','123 Main St','Contract labor:Rental Cleanings','','']];

export default function Cleaners() {
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const canManageCleaners = canManageBusiness(user);
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);

  const { data: cleaners = [], isLoading } = useQuery({
    queryKey: ['cleaners', businessId, userIsSystemAdmin],
    enabled: Boolean(user) && (userIsSystemAdmin || Boolean(businessId)),
    queryFn: () => {
      if(userIsSystemAdmin) {
        return base44.entities.Cleaner.list('cleaner_name', 500);
      }  
      
      return base44.entities.Cleaner.filter(
        { business_id: businessId },
        'cleaner_name',
        500
      );
    },  
      initialData: [],
  });

  const handleSave = async () => {
    try {
      if (!canManageCleaners) {
        toast.error('You do not have permission to manage cleaners');
        return;
      }

      if (!form.cleaner_name?.trim()) {
        toast.error('Cleaner name is required');
        return;
      }

      const cleanerBusinessId = userIsSystemAdmin
        ? form.business_id || businessId
        : businessId;

      if (!cleanerBusinessId) {
        toast.error('Cannot save cleaner because your user is missing business_id');
        return;
      }

      const cleanerName = form.cleaner_name.trim();
      const cleanerCode = (form.cleaner_code || cleanerName)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 20);

      const payload = {
        ...form,
        business_id: cleanerBusinessId,
        cleaner_name: cleanerName,
        cleaner_code: cleanerCode,
        email: form.email?.trim() || '',
        phone: form.phone?.trim() || '',
        qbo_vendor_name: form.qbo_vendor_name?.trim() || cleanerName,
        active: form.active !== false,
      };

      if (editId) {
        await base44.entities.Cleaner.update(editId, payload);
        toast.success('Cleaner updated');
      } else {
        await base44.entities.Cleaner.create(payload);
        toast.success('Cleaner created');
      }

      setDialogOpen(false);
      setForm(emptyForm);
      setEditId(null);
      qc.invalidateQueries({ queryKey: ['cleaners'] });
    } catch (error) {
      console.error('Cleaner save failed:', error);
      toast.error(error?.message || 'Failed to save cleaner');
    }
  };

  const openEdit = (c) => {
    setForm({
      business_id: c.business_id || businessId,
      cleaner_name: c.cleaner_name || '', qbo_vendor_name: c.qbo_vendor_name || '',
      cleaner_code: c.cleaner_code || '', email: c.email || '', phone: c.phone || '',
      mailing_address: c.mailing_address || '', active: c.active !== false,
      default_expense_account: c.default_expense_account || 'Contract labor:Rental Cleanings',
      hostaway_user_id: c.hostaway_user_id || '', notes: c.notes || '',
    });
    setEditId(c.id);
    setDialogOpen(true);
  };

  const update = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleCsvImport = async (rows) => {
    if (!canManageCleaners) {
      toast.error('You do not have permission to import cleaners');
      return;
    }

  const importBusinessId = getBusinessId(user);

  if (!importBusinessId) {
    toast.error('Cannot import cleaners because your user is missing business_id');
    return;
  }

  for (const row of rows) {
      if (!row.cleaner_name || !row.cleaner_code) continue;
      await base44.entities.Cleaner.create({
        business_id: importBusinessId,
        cleaner_name: row.cleaner_name,
        cleaner_code: (row.cleaner_code || '').toUpperCase(),
        email: row.email || '',
        phone: row.phone || '',
        qbo_vendor_name: row.qbo_vendor_name || '',
        mailing_address: row.mailing_address || '',
        default_expense_account: row.default_expense_account || 'Contract labor:Rental Cleanings',
        hostaway_user_id: row.hostaway_user_id || '',
        notes: row.notes || '',
        active: true,
      });
    }
    qc.invalidateQueries({ queryKey: ['cleaners'] });
  };

  return (
    <div>
      <PageHeader
        title="Cleaners"
        description="Manage cleaner records and billing information"
        actions={
          <div className="flex items-center gap-2">
            {canManageCleaners && (
              <>
                <CsvUploadButton
                  templateHeaders={CLEANER_TEMPLATE_HEADERS}
                  templateRows={CLEANER_TEMPLATE_ROWS}
                  templateFilename="cleaners_template.csv"
                  onParsed={handleCsvImport}
                  label="Upload Cleaners"
                />
                <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setForm(emptyForm); setEditId(null); } }}>
                <DialogTrigger asChild>
                  <Button><Plus className="w-4 h-4 mr-2" />Add Cleaner</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Add'} Cleaner</DialogTitle></DialogHeader>
                  <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Cleaner Name *</Label><Input value={form.cleaner_name} onChange={e => update('cleaner_name', e.target.value)} className="mt-1" /></div>
                      <div><Label>Cleaner Code *</Label><Input value={form.cleaner_code} onChange={e => update('cleaner_code', e.target.value.toUpperCase())} placeholder="e.g. ALLAN" className="mt-1 font-mono" /></div>
                    </div>
                    <div><Label>QBO Vendor Name</Label><Input value={form.qbo_vendor_name} onChange={e => update('qbo_vendor_name', e.target.value)} className="mt-1" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => update('email', e.target.value)} className="mt-1" /></div>
                      <div><Label>Phone</Label><Input value={form.phone} onChange={e => update('phone', e.target.value)} className="mt-1" /></div>
                    </div>
                    <div><Label>Mailing Address</Label><Textarea value={form.mailing_address} onChange={e => update('mailing_address', e.target.value)} className="mt-1" rows={2} /></div>
                    <div><Label>Default Expense Account</Label><Input value={form.default_expense_account} onChange={e => update('default_expense_account', e.target.value)} className="mt-1 font-mono text-sm" /></div>
                    <div><Label>Hostaway User ID</Label><Input value={form.hostaway_user_id} onChange={e => update('hostaway_user_id', e.target.value)} placeholder="Numeric ID from Hostaway" className="mt-1 font-mono text-sm" /></div>
                    <div className="flex items-center gap-2">
                      <Switch checked={form.active} onCheckedChange={v => update('active', v)} />
                      <Label>Active</Label>
                    </div>
                    <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => update('notes', e.target.value)} className="mt-1" rows={2} /></div>
                    <Button onClick={handleSave} className="w-full">{editId ? 'Update' : 'Create'} Cleaner</Button>
                  </div>
                </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        }
      />

      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>QBO Vendor</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Hostaway User ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : cleaners.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No cleaners yet. Add your first cleaner or upload a CSV.</TableCell></TableRow>
            ) : cleaners.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.cleaner_name}</TableCell>
                <TableCell className="font-mono text-xs">{c.cleaner_code}</TableCell>
                <TableCell className="text-sm">{c.qbo_vendor_name}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>}
                    {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-xs font-mono">{c.hostaway_user_id || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={c.active !== false ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>
                    {c.active !== false ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canManageCleaners && (
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}