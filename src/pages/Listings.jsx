import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, DollarSign } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import ListingRatesDialog from '@/components/listings/ListingRatesDialog';
import CsvUploadButton from '@/components/shared/CsvUploadButton';
import { toast } from 'sonner';
import { getBusinessId, canManageBusiness, isSystemAdmin } from '@/lib/roles';

const emptyForm = {
  listing_name: '',
  hostaway_listing_id: '',
  qbo_class_name: '',
  owner_name: '',
  owner_id: '',
  default_cleaner_id: '',
  active: true,
  notes: '',
};

const LISTING_TEMPLATE_HEADERS = ['listing_name', 'hostaway_listing_id', 'qbo_class_name', 'owner_name', 'notes'];
const LISTING_TEMPLATE_ROWS = [['Casa Del Sol', '12345', 'Casa Del Sol', 'John Owner', 'Main house by the river']];

export default function Listings() {
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const canManageListings = canManageBusiness(user);
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [ratesListingId, setRatesListingId] = useState(null);

  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['listings', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Listing.list('listing_name', 500)
      : base44.entities.Listing.filter({ business_id: businessId }, 'listing_name', 500),
    initialData: [],
  });

  const { data: cleaners = [] } = useQuery({
    queryKey: ['cleaners', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Cleaner.list('cleaner_name', 500)
      : base44.entities.Cleaner.filter({ business_id: businessId, active: true }, 'cleaner_name', 500),
    initialData: [],
  });

  const { data: hostawayUsers = [] } = useQuery({
    queryKey: ['hostawayMappings', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.HostawayUserCleanerMapping.list('hostaway_user_name', 500)
      : base44.entities.HostawayUserCleanerMapping.filter({ business_id: businessId }, 'hostaway_user_name', 500),
    initialData: [],
  });

  const handleSave = async () => {
    if (!canManageListings) {
      toast.error('You do not have permission to manage listings');
      return;
    }

    if (!form.listing_name) {
      toast.error('Listing name is required');
      return;
    }

    const listingBusinessId = userIsSystemAdmin ? form.business_id || businessId : businessId;
    if (!listingBusinessId) {
      toast.error('Cannot save listing because your user is missing business_id');
      return;
    }

    const payload = {
      ...form,
      business_id: listingBusinessId,
      default_cleaner_id: form.default_cleaner_id === 'none' ? '' : form.default_cleaner_id,
      active: form.active !== false,
    };

    if (editId) {
      await base44.entities.Listing.update(editId, payload);
      toast.success('Listing updated');
    } else {
      await base44.entities.Listing.create(payload);
      toast.success('Listing created');
    }

    setDialogOpen(false);
    setForm(emptyForm);
    setEditId(null);
    qc.invalidateQueries({ queryKey: ['listings'] });
  };

  const openEdit = (l) => {
    setForm({
      business_id: l.business_id || businessId,
      listing_name: l.listing_name || '',
      hostaway_listing_id: l.hostaway_listing_id || '',
      qbo_class_name: l.qbo_class_name || '',
      owner_name: l.owner_name || '',
      owner_id: l.owner_id || '',
      default_cleaner_id: l.default_cleaner_id || '',
      active: l.active !== false,
      notes: l.notes || '',
    });
    setEditId(l.id);
    setDialogOpen(true);
  };

  const update = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleCsvImport = async (rows) => {
    if (!canManageListings) {
      toast.error('You do not have permission to import listings');
      return;
    }

    const importBusinessId = businessId;
    if (!importBusinessId) {
      toast.error('Cannot import listings because your user is missing business_id');
      return;
    }

    for (const row of rows) {
      if (!row.listing_name) continue;
      await base44.entities.Listing.create({
        business_id: importBusinessId,
        listing_name: row.listing_name,
        hostaway_listing_id: row.hostaway_listing_id || '',
        qbo_class_name: row.qbo_class_name || '',
        owner_name: row.owner_name || '',
        notes: row.notes || '',
        active: true,
      });
    }
    qc.invalidateQueries({ queryKey: ['listings'] });
  };

  return (
    <div>
      <PageHeader
        title="Listings"
        description="Manage properties and cleaning rate history"
        actions={
          canManageListings && (
            <div className="flex items-center gap-2">
              <CsvUploadButton
                templateHeaders={LISTING_TEMPLATE_HEADERS}
                templateRows={LISTING_TEMPLATE_ROWS}
                templateFilename="listings_template.csv"
                onParsed={handleCsvImport}
                label="Upload Listings"
              />
              <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setForm(emptyForm); setEditId(null); } }}>
                <DialogTrigger asChild>
                  <Button><Plus className="w-4 h-4 mr-2" />Add Listing</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Add'} Listing</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Listing Name *</Label><Input value={form.listing_name} onChange={e => update('listing_name', e.target.value)} className="mt-1" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Hostaway Listing ID</Label><Input value={form.hostaway_listing_id} onChange={e => update('hostaway_listing_id', e.target.value)} className="mt-1" /></div>
                      <div><Label>QBO Class Name</Label><Input value={form.qbo_class_name} onChange={e => update('qbo_class_name', e.target.value)} className="mt-1" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Owner</Label>
                        <Select
                          value={form.owner_id || '__manual__'}
                          onValueChange={v => {
                            if (v === '__manual__') {
                              update('owner_id', '');
                            } else if (v === '__clear__') {
                              setForm(f => ({ ...f, owner_id: '', owner_name: '' }));
                            } else {
                              const hostawayUser = hostawayUsers.find(u => u.hostaway_user_id === v);
                              setForm(f => ({ ...f, owner_id: v, owner_name: hostawayUser?.hostaway_user_name || v }));
                            }
                          }}
                        >
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select owner" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__clear__">— Clear owner —</SelectItem>
                            {hostawayUsers.map(hostawayUser => (
                              <SelectItem key={hostawayUser.hostaway_user_id} value={hostawayUser.hostaway_user_id}>
                                {hostawayUser.hostaway_user_name || hostawayUser.hostaway_user_email || hostawayUser.hostaway_user_id}
                              </SelectItem>
                            ))}
                            <SelectItem value="__manual__">— Enter manually —</SelectItem>
                          </SelectContent>
                        </Select>
                        {(!form.owner_id) && (
                          <Input
                            value={form.owner_name}
                            onChange={e => update('owner_name', e.target.value)}
                            placeholder="Owner name"
                            className="mt-1"
                          />
                        )}
                      </div>
                      <div>
                        <Label>Default Cleaner</Label>
                        <Select value={form.default_cleaner_id || 'none'} onValueChange={v => update('default_cleaner_id', v === 'none' ? '' : v)}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select cleaner" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {cleaners.map(c => <SelectItem key={c.id} value={c.id}>{c.cleaner_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={v => update('active', v)} /><Label>Active</Label></div>
                    <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => update('notes', e.target.value)} className="mt-1" rows={2} /></div>
                    <Button onClick={handleSave} className="w-full">{editId ? 'Update' : 'Create'} Listing</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )
        }
      />

      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Listing Name</TableHead>
              <TableHead>Hostaway ID</TableHead>
              <TableHead>QBO Class</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Default Cleaner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : listings.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No listings yet. Add one or upload a CSV.</TableCell></TableRow>
            ) : listings.map((listing) => {
              const cleaner = cleaners.find(c => c.id === listing.default_cleaner_id);
              return (
                <TableRow key={listing.id}>
                  <TableCell className="font-medium">{listing.listing_name}</TableCell>
                  <TableCell className="font-mono text-xs">{listing.hostaway_listing_id}</TableCell>
                  <TableCell className="text-sm">{listing.qbo_class_name}</TableCell>
                  <TableCell className="text-sm">{listing.owner_name}</TableCell>
                  <TableCell className="text-sm">{cleaner?.cleaner_name || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={listing.active !== false ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>
                      {listing.active !== false ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setRatesListingId(listing.id)} title="Cleaning Rates"><DollarSign className="w-3.5 h-3.5" /></Button>
                      {canManageListings && <Button variant="ghost" size="icon" onClick={() => openEdit(listing)}><Pencil className="w-3.5 h-3.5" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {ratesListingId && (
        <ListingRatesDialog
          listingId={ratesListingId}
          listings={listings}
          cleaners={cleaners}
          onClose={() => setRatesListingId(null)}
        />
      )}
    </div>
  );
}
