import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Trash2, Loader2, Building2, Users, UserPlus, ShieldAlert, RefreshCw, Pencil } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { toast } from 'sonner';
import { getBase44Role, getBusinessRole, getBusinessId, getRoleLabel, isSystemAdmin, getBusinessName } from '@/lib/roles';

const CLEARABLE_ENTITIES = [
  { key: 'CleaningTask', label: 'Cleaning Tasks', entity: 'CleaningTask' },
  { key: 'Reservation', label: 'Reservations', entity: 'Reservation' },
  { key: 'QboCleanerRevenueLine', label: 'QBO Revenue Lines', entity: 'QboCleanerRevenueLine' },
  { key: 'MatchResult', label: 'Match Results', entity: 'MatchResult' },
  { key: 'PayoutItem', label: 'Payout Items', entity: 'PayoutItem' },
  { key: 'PayoutRun', label: 'Payout Runs', entity: 'PayoutRun' },
  { key: 'ImportBatch', label: 'Import Batches', entity: 'ImportBatch' },
  { key: 'AuditLog', label: 'Audit Logs', entity: 'AuditLog' },
];

const emptyBiz = { name: '', slug: '', max_owner_admins: 2, max_managers: 2, max_users: 3 };
const emptyUserForm = { base44_role: 'user', business_role: 'staff', business_id: '', cleaner_id: '' };

export default function SuperAdmin() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [bizDialogOpen, setBizDialogOpen] = useState(false);
  const [bizForm, setBizForm] = useState(emptyBiz);
  const [editBizDialogOpen, setEditBizDialogOpen] = useState(false);
  const [editingBiz, setEditingBiz] = useState(null);
  const [editBizForm, setEditBizForm] = useState(emptyBiz);
  const [savingBiz, setSavingBiz] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBase44Role, setInviteBase44Role] = useState('user');
  const [inviteBusinessRole, setInviteBusinessRole] = useState('staff');
  const [inviteBusinessId, setInviteBusinessId] = useState('');
  const [inviteCleanerId, setInviteCleanerId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [creatingBiz, setCreatingBiz] = useState(false);
  const [clearingEntity, setClearingEntity] = useState(null);
  const [entityCounts, setEntityCounts] = useState({});
  const [editUserDialogOpen, setEditUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editUserForm, setEditUserForm] = useState(emptyUserForm);
  const [savingUser, setSavingUser] = useState(false);
  const userIsSystemAdmin = isSystemAdmin(user);

  const { data: businesses = [], isLoading: bizLoading } = useQuery({
    queryKey: ['businesses'],
    queryFn: () => base44.entities.Business.list('name', 100),
    initialData: [],
    enabled: userIsSystemAdmin,
  });

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list('email', 200),
    initialData: [],
    enabled: userIsSystemAdmin,
  });

  const { data: cleaners = [] } = useQuery({
    queryKey: ['allCleanersForUserAdmin'],
    queryFn: () => base44.entities.Cleaner.list('cleaner_name', 500),
    initialData: [],
    enabled: userIsSystemAdmin,
  });

  if (!userIsSystemAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <ShieldAlert className="w-10 h-10" />
        <p className="text-sm">Super Admin access required.</p>
      </div>
    );
  }

  const businessName = (businessId) => businesses.find(b => b.id === businessId)?.name || businessId || '—';
  const businessCleaners = cleaners.filter(c => !editUserForm.business_id || c.business_id === editUserForm.business_id);
  const inviteBusinessCleaners = cleaners.filter(c => !inviteBusinessId || c.business_id === inviteBusinessId);

  const openEditBusiness = (biz) => {
    setEditingBiz(biz);
    setEditBizForm({
      name: biz.name || '',
      slug: biz.slug || '',
      max_owner_admins: biz.max_owner_admins ?? 2,
      max_managers: biz.max_managers ?? 2,
      max_users: biz.max_users ?? 3,
      active: biz.active !== false,
    });
    setEditBizDialogOpen(true);
  };
  
  const handleCreateBusiness = async () => {
    if (!bizForm.name?.trim()) { toast.error('Business name is required'); return; }
    setCreatingBiz(true);
    try {
      await base44.entities.Business.create({ ...bizForm, name: bizForm.name.trim(), active: true });
      toast.success(`Business "${bizForm.name}" created`);
      setBizForm(emptyBiz);
      setBizDialogOpen(false);
      qc.invalidateQueries({ queryKey: ['businesses'] });
    } catch (err) {
      toast.error('Business create failed: ' + (err.message || 'Unknown error'));
    } finally {
      setCreatingBiz(false);
    }
  };

  const handleSaveBusiness = async () => {
    if (!editingBiz) return;
    if (!editBizForm.name?.trim()) {
      toast.error('Business name is required');
      return;
    }

    setSavingBiz(true);

    try {
      const updatedName = editBizForm.name.trim();

      await base44.entities.Business.update(editingBiz.id, {
        ...editBizForm,
        name: updatedName,
      });

      // Keep User.business_name in sync for the sidebar
      const usersToUpdate = users.filter(u => getBusinessId(u) === editingBiz.id);

      await Promise.all(
        usersToUpdate.map(u =>
          base44.entities.User.update(u.id, {
            business_name: updatedName,
          })
        )
      );

      toast.success(`Business "${updatedName}" updated`);
      setEditBizDialogOpen(false);
      setEditingBiz(null);

      qc.invalidateQueries({ queryKey: ['businesses'] });
      qc.invalidateQueries({ queryKey: ['allUsers'] });
    } catch (err) {
      toast.error('Business update failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSavingBiz(false);
    }
  };

  const handleDeleteBusiness = async (biz) => {
    await base44.entities.Business.delete(biz.id);
    toast.success(`Business "${biz.name}" deleted`);
    qc.invalidateQueries({ queryKey: ['businesses'] });
  };

  const handleInviteUser = async () => {
    if (!inviteEmail?.trim()) { toast.error('Email is required'); return; }
    if (inviteBase44Role !== 'admin' && !inviteBusinessId) { toast.error('Business is required for Base44 user accounts'); return; }
    if (inviteBusinessRole === 'cleaner' && !inviteCleanerId) { toast.error('Cleaner link is required when business role is Cleaner'); return; }

    setInviting(true);
    try {
      const allUsers = await base44.entities.User.list('email', 200);
      let targetUser = allUsers.find(u => u.email?.toLowerCase() === inviteEmail.trim().toLowerCase());

      if (!targetUser) {
        await base44.users.inviteUser(inviteEmail.trim(), inviteBase44Role);
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const refreshed = await base44.entities.User.list('email', 200);
          targetUser = refreshed.find(u => u.email?.toLowerCase() === inviteEmail.trim().toLowerCase());
          if (targetUser) break;
        }
      }

      if (targetUser) {
        await base44.entities.User.update(targetUser.id, {
          business_role: inviteBusinessRole,
          business_id: inviteBusinessId || '',
          business_name: inviteBusinessId ? businessName(inviteBusinessId) : '',
          cleaner_id: inviteBusinessRole === 'cleaner' ? inviteCleanerId : '',
          active: true,
        });
        toast.success(`User ${inviteEmail} set to ${inviteBusinessRole}${inviteBusinessId ? ` for ${businessName(inviteBusinessId)}` : ''}.`);
      } else {
        toast.warning('Invite sent, but the user record did not appear yet. Use Edit in the Users table after they accept.');
      }

      qc.invalidateQueries({ queryKey: ['allUsers'] });
      setInviteEmail('');
      setInviteBase44Role('user');
      setInviteBusinessRole('staff');
      setInviteBusinessId('');
      setInviteCleanerId('');
    } catch (err) {
      toast.error('Invite failed: ' + (err.message || 'Unknown error'));
    } finally {
      setInviting(false);
    }
  };

  const openEditUser = (u) => {
    setEditingUser(u);
    setEditUserForm({
      base44_role: getBase44Role(u),
      business_role: getBusinessRole(u),
      business_id: getBusinessId(u),
      cleaner_id: u.cleaner_id || u.data?.cleaner_id || u.data?.data?.cleaner_id || '',
    });
    setEditUserDialogOpen(true);
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;
    setSavingUser(true);
    try {

      const selectedBusiness = businesses.find(
        b => String(b.id) === String(editUserForm.business_id)
      );
      await base44.entities.User.update(editingUser.id, {
        business_role: editUserForm.business_role,
        business_id: editUserForm.business_id,
        business_name: selectedBusiness?.name || '',
        cleaner_id: editUserForm.business_role === 'cleaner' ? editUserForm.cleaner_id : '',
      });
      toast.success('User updated');
      setEditUserDialogOpen(false);
      qc.invalidateQueries({ queryKey: ['allUsers'] });
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown'));
    } finally {
      setSavingUser(false);
    }
  };

  const handleClearEntity = async (entityKey) => {
    setClearingEntity(entityKey);
    try {
      const entity = base44.entities[entityKey];
      let records = await entity.list('-created_date', 200);
      let total = 0;
      while (records.length > 0) {
        await Promise.all(records.map(r => entity.delete(r.id)));
        total += records.length;
        records = await entity.list('-created_date', 200);
      }
      toast.success(`Cleared ${total} ${entityKey} records`);
      setEntityCounts(prev => ({ ...prev, [entityKey]: 0 }));
    } catch (err) {
      toast.error('Clear failed: ' + (err.message || 'Unknown'));
    }
    setClearingEntity(null);
  };

  const handleLoadCounts = async () => {
    const counts = {};
    await Promise.all(CLEARABLE_ENTITIES.map(async (e) => {
      const rows = await base44.entities[e.entity].list('-created_date', 1);
      counts[e.key] = rows.length > 0 ? '1+' : '0';
    }));
    setEntityCounts(counts);
    toast.success('Counts loaded (showing 0 or 1+ due to pagination)');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super Admin"
        description="System-wide administration: businesses, users, and data management"
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Businesses</CardTitle>
              <CardDescription>Create and manage tenant businesses</CardDescription>
            </div>
            <Button size="sm" onClick={() => setBizDialogOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />New Business
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bizLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading...</div>
          ) : businesses.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No businesses yet. Create the first one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Max Owner Admins</TableHead>
                  <TableHead>Max Managers</TableHead>
                  <TableHead>Max Staff</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {businesses.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="font-mono text-xs">{b.slug || '—'}</TableCell>
                    <TableCell>{b.max_owner_admins ?? 2}</TableCell>
                    <TableCell>{b.max_managers ?? 2}</TableCell>
                    <TableCell>{b.max_users ?? 3}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={b.active !== false ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500'}>
                        {b.active !== false ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEditBusiness(b)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Business?</AlertDialogTitle>
                            <AlertDialogDescription>This will permanently delete the business record. Tenant data must be cleared separately.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive text-white" onClick={() => handleDeleteBusiness(b)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><UserPlus className="w-4 h-4" />Invite User</CardTitle>
          <CardDescription>Base44 role controls platform access. Business role controls CleanPay permissions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-7 gap-3 items-end">
            <div className="sm:col-span-2">
              <Label className="text-xs mb-1">Email Address</Label>
              <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="user@example.com" type="email" />
            </div>
            <div>
              <Label className="text-xs mb-1">Base44 Role</Label>
              <Select value={inviteBase44Role} onValueChange={setInviteBase44Role}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1">Business Role</Label>
              <Select value={inviteBusinessRole} onValueChange={v => { setInviteBusinessRole(v); if (v !== 'cleaner') setInviteCleanerId(''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner_admin">Owner-Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="cleaner">Cleaner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1">Business</Label>
              <Select value={inviteBusinessId || '__none__'} onValueChange={v => { setInviteBusinessId(v === '__none__' ? '' : v); setInviteCleanerId(''); }}>
                <SelectTrigger><SelectValue placeholder="Select business" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No Business —</SelectItem>
                  {businesses.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1">Cleaner Link</Label>
              <Select value={inviteCleanerId || '__none__'} onValueChange={v => setInviteCleanerId(v === '__none__' ? '' : v)} disabled={inviteBusinessRole !== 'cleaner'}>
                <SelectTrigger><SelectValue placeholder="Cleaner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No Cleaner —</SelectItem>
                  {inviteBusinessCleaners.map(c => <SelectItem key={c.id} value={c.id}>{c.cleaner_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleInviteUser} disabled={inviting || !inviteEmail}>
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Send Invite
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />All Users</CardTitle>
          <CardDescription>View and manage all registered users, their Base44 roles, business roles, and business assignments.</CardDescription>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Base44 Role</TableHead>
                    <TableHead>Business Role</TableHead>
                    <TableHead>Business</TableHead>
                    <TableHead>Cleaner Link</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => {
                    const base44Role = getBase44Role(u);
                    const businessRole = getBusinessRole(u);
                    const bizId = getBusinessId(u);
                    const linkedCleanerId = u.cleaner_id || u.data?.cleaner_id || u.data?.data?.cleaner_id || '';
                    const linkedCleaner = cleaners.find(c => c.id === linkedCleanerId);
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="text-sm">{u.email}</TableCell>
                        <TableCell className="text-sm">{u.full_name || '—'}</TableCell>
                        <TableCell><Badge variant="outline">{base44Role}</Badge></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            businessRole === 'owner_admin' ? 'bg-violet-100 text-violet-700 border-violet-200' :
                            businessRole === 'manager' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                            businessRole === 'cleaner' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                            'bg-slate-100 text-slate-600 border-slate-200'
                          }>
                            {getRoleLabel(businessRole)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{businessName(bizId)}</TableCell>
                        <TableCell className="text-sm">{linkedCleaner?.cleaner_name || linkedCleanerId || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{u.created_date ? new Date(u.created_date).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => openEditUser(u)}>
                            <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-destructive"><ShieldAlert className="w-4 h-4" />Data Management — Danger Zone</CardTitle>
          <CardDescription>Clear entity tables for testing or reset. This is permanent and cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" size="sm" onClick={handleLoadCounts}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />Check Record Counts
          </Button>
          <div className="grid sm:grid-cols-2 gap-2">
            {CLEARABLE_ENTITIES.map(e => (
              <AlertDialog key={e.key}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="justify-between border-destructive/30 hover:bg-destructive/5 hover:text-destructive" disabled={clearingEntity === e.key}>
                    <span className="flex items-center gap-2">
                      {clearingEntity === e.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Clear {e.label}
                    </span>
                    {entityCounts[e.key] !== undefined && <Badge variant="outline" className="text-xs ml-2">{entityCounts[e.key]}</Badge>}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear all {e.label}?</AlertDialogTitle>
                    <AlertDialogDescription>This will permanently delete ALL {e.label} records. This cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-destructive text-white" onClick={() => handleClearEntity(e.key)}>
                      Yes, Clear All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={editUserDialogOpen} onOpenChange={v => { setEditUserDialogOpen(v); if (!v) setEditingUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit User: {editingUser?.email}</DialogTitle></DialogHeader>
          {editingUser && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Name: <span className="font-medium text-foreground">{editingUser.full_name || '—'}</span></p>
              <div>
                <Label>Base44 Role</Label>
                <Input value={editUserForm.base44_role} disabled className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1">Change this in Base44's user/admin screen, not CleanPay.</p>
              </div>
              <div>
                <Label>Business Role</Label>
                <Select value={editUserForm.business_role} onValueChange={v => setEditUserForm(f => ({ ...f, business_role: v, cleaner_id: v === 'cleaner' ? f.cleaner_id : '' }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner_admin">Owner-Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="cleaner">Cleaner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Business</Label>
                <Select value={editUserForm.business_id || '__none__'} onValueChange={v => setEditUserForm(f => ({ ...f, business_id: v === '__none__' ? '' : v, cleaner_id: '' }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select business" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No Business —</SelectItem>
                    {businesses.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cleaner Link</Label>
                <Select value={editUserForm.cleaner_id || '__none__'} onValueChange={v => setEditUserForm(f => ({ ...f, cleaner_id: v === '__none__' ? '' : v }))} disabled={editUserForm.business_role !== 'cleaner'}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select cleaner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No Cleaner —</SelectItem>
                    {businessCleaners.map(c => <SelectItem key={c.id} value={c.id}>{c.cleaner_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUserDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveUser} disabled={savingUser}>
              {savingUser ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={editBizDialogOpen} onOpenChange={v => { setEditBizDialogOpen(v); if (!v) setEditingBiz(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Business</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Business Name *</Label>
              <Input
                value={editBizForm.name}
                onChange={e => setEditBizForm(f => ({ ...f, name: e.target.value }))}
                className="mt-1"
                placeholder="Business name"
              />
            </div>

            <div>
              <Label>Slug / Short ID</Label>
              <Input
                value={editBizForm.slug}
                onChange={e => setEditBizForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                className="mt-1 font-mono"
                placeholder="business-slug"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Max Owner-Admins</Label>
                <Input
                  type="number"
                  value={editBizForm.max_owner_admins}
                  onChange={e => setEditBizForm(f => ({ ...f, max_owner_admins: parseInt(e.target.value) || 2 }))}
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="text-xs">Max Managers</Label>
                <Input
                  type="number"
                  value={editBizForm.max_managers}
                  onChange={e => setEditBizForm(f => ({ ...f, max_managers: parseInt(e.target.value) || 2 }))}
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="text-xs">Max Staff</Label>
                <Input
                  type="number"
                  value={editBizForm.max_users}
                  onChange={e => setEditBizForm(f => ({ ...f, max_users: parseInt(e.target.value) || 3 }))}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBizDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveBusiness} disabled={savingBiz}>
              {savingBiz ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Save Business
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={bizDialogOpen} onOpenChange={v => { setBizDialogOpen(v); if (!v) setBizForm(emptyBiz); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create New Business</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Business Name *</Label><Input value={bizForm.name} onChange={e => setBizForm(f => ({ ...f, name: e.target.value }))} className="mt-1" placeholder="Acme Rentals" /></div>
            <div><Label>Slug (short ID)</Label><Input value={bizForm.slug} onChange={e => setBizForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} className="mt-1 font-mono" placeholder="acme-rentals" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Max Owner-Admins</Label><Input type="number" value={bizForm.max_owner_admins} onChange={e => setBizForm(f => ({ ...f, max_owner_admins: parseInt(e.target.value) }))} className="mt-1" /></div>
              <div><Label className="text-xs">Max Managers</Label><Input type="number" value={bizForm.max_managers} onChange={e => setBizForm(f => ({ ...f, max_managers: parseInt(e.target.value) }))} className="mt-1" /></div>
              <div><Label className="text-xs">Max Staff</Label><Input type="number" value={bizForm.max_users} onChange={e => setBizForm(f => ({ ...f, max_users: parseInt(e.target.value) }))} className="mt-1" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBizDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateBusiness} disabled={creatingBiz}>
              {creatingBiz ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Create Business
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

