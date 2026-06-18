import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getAppRole, getBusinessId } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Wifi, WifiOff, RefreshCw, Loader2, CheckCircle2, AlertCircle,
  FlaskConical, Download, Calendar, Plug, Users, Building2, PlusCircle, UserPlus
} from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';


function StatusPill({ status }) {
  const map = {
    'Connected': 'bg-emerald-100 text-emerald-800 border-emerald-200',
    'Error': 'bg-red-100 text-red-800 border-red-200',
    'Token Expired': 'bg-amber-100 text-amber-800 border-amber-200',
    'Not Configured': 'bg-gray-100 text-gray-600 border-gray-200',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${map[status] || map['Not Configured']}`}>
      {status === 'Connected' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
      {status}
    </span>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  try { return format(new Date(d), 'MMM d, yyyy HH:mm'); } catch { return d; }
}

export default function HostawaySettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const BUSINESS_ID = getBusinessId(user);

  // Credentials form
  const [accountId, setAccountId] = useState('');
  const [apiKey, setApiKey] = useState('');

  // Date range for sync
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Loading states
  const [loading, setLoading] = useState({});
  const setLoad = (key, val) => setLoading(l => ({ ...l, [key]: val }));

  // Test result dialog
  const [testResult, setTestResult] = useState(null);
  const [testResultOpen, setTestResultOpen] = useState(false);
  const [testResultTab, setTestResultTab] = useState('mapped');

  // Mappings edit
  const [editingMapping, setEditingMapping] = useState(null);
  const [cleanerOptions, setCleanerOptions] = useState([]);

  // Add as Owner dialog
  const [ownerDialogUser, setOwnerDialogUser] = useState(null);
  const [ownerListingIds, setOwnerListingIds] = useState([]);

  // Listings pull
  const [fetchedListings, setFetchedListings] = useState([]);
  const [existingListings, setExistingListings] = useState([]);

  const { data: setting } = useQuery({
    queryKey: ['hostawayApiSetting', BUSINESS_ID],
    queryFn: async () => {
      if (!BUSINESS_ID) return null;
      // Use the backend function to fetch setting — token is never returned to the client
      const res = await base44.functions.invoke('hostawaySync', {
        action: 'get_setting',
        business_id: BUSINESS_ID,
      });
      return res.data?.setting || null;
    },
    enabled: !!BUSINESS_ID,
  });

  const { data: mappings = [], refetch: refetchMappings } = useQuery({
    queryKey: ['hostawayMappings', BUSINESS_ID],
    queryFn: () => base44.entities.HostawayUserCleanerMapping.filter({ business_id: BUSINESS_ID }),
    enabled: !!BUSINESS_ID,
  });

  useEffect(() => {
    if (setting?.hostaway_account_id) setAccountId(setting.hostaway_account_id);
  }, [setting]);

  useEffect(() => {
    if (!BUSINESS_ID) return;
    base44.entities.Cleaner.filter({ business_id: BUSINESS_ID }, 'cleaner_name', 200).then(setCleanerOptions);
    base44.entities.Listing.filter({ business_id: BUSINESS_ID }, 'listing_name', 200).then(setExistingListings);
  }, [BUSINESS_ID]);

  // Default date range: last 14 days
  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 14);
    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
  }, []);

  const invoke = async (action, extra = {}) => {
    try {
      return await base44.functions.invoke('hostawaySync', {
        action,
        business_id: BUSINESS_ID,
        account_id: accountId,
        api_key: apiKey,
        ...extra,
      });
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Server error';
      toast.error(`${action} failed: ${msg}`);
      return { data: { success: false, error: msg } };
    }
  };

  const handleSaveCredentials = async () => {
    if (!BUSINESS_ID) { toast.error('Missing business ID — your user account is not linked to a business. Contact your admin.'); return; }
    if (!accountId || !apiKey) { toast.error('Account ID and API Key are required'); return; }
    setLoad('save', true);
    const res = await invoke('save_credentials');
    if (res.data?.success) { toast.success('Credentials saved'); qc.invalidateQueries(['hostawayApiSetting']); }
    else toast.error(res.data?.error || 'Save failed');
    setLoad('save', false);
  };

  const handleGetToken = async () => {
    if (!accountId || !apiKey) { toast.error('Enter Account ID and API Key first'); return; }
    setLoad('token', true);
    const res = await invoke('get_token');
    if (res.data?.success) { toast.success('Access token obtained successfully'); qc.invalidateQueries(['hostawayApiSetting']); }
    else toast.error(res.data?.error || 'Token request failed');
    setLoad('token', false);
  };

  const handleTestConnection = async () => {
    setLoad('test_conn', true);
    const res = await invoke('test_connection');
    if (res.data?.success) { toast.success(res.data.message); qc.invalidateQueries(['hostawayApiSetting']); }
    else toast.error(res.data?.error || 'Connection test failed');
    setLoad('test_conn', false);
  };

  const handleTestPull = async (type) => {
    const key = type === 'reservations' ? 'test_res' : 'test_tasks';
    setLoad(key, true);
    const action = type === 'reservations' ? 'test_reservations' : 'test_tasks';
    const res = await invoke(action);
    if (res.data?.success) {
      setTestResult({ type, raw: res.data.raw, mapped: res.data.mapped });
      setTestResultTab('mapped');
      setTestResultOpen(true);
    } else {
      toast.error(res.data?.error || 'Test pull failed');
    }
    setLoad(key, false);
  };

  const handleSaveTestResults = async () => {
    if (!testResult) return;
    setLoad('save_test', true);
    const action = testResult.type === 'reservations' ? 'sync_reservations' : 'sync_tasks';
    // Use the full range dates but only for the small set we already have
    // For save-test we run a sync against the same small date range
    const res = await invoke(action, { start_date: startDate, end_date: endDate });
    if (res.data?.success) {
      toast.success(`Saved: ${res.data.created} created, ${res.data.updated} updated`);
      setTestResultOpen(false);
      qc.invalidateQueries();
    } else {
      toast.error(res.data?.error || 'Save failed');
    }
    setLoad('save_test', false);
  };

  const handleSync = async (type) => {
    if (!startDate || !endDate) { toast.error('Set start and end date first'); return; }
    const key = type === 'reservations' ? 'sync_res' : 'sync_tasks';
    setLoad(key, true);
    const action = type === 'reservations' ? 'sync_reservations' : 'sync_tasks';
    const res = await invoke(action, { start_date: startDate, end_date: endDate });
    if (res.data?.success) {
      toast.success(`${type} sync complete: ${res.data.created} created, ${res.data.updated} updated`);
      qc.invalidateQueries(['hostawayApiSetting']);
      qc.invalidateQueries(['hostawayMappings']);
    } else {
      toast.error(res.data?.error || 'Sync failed');
    }
    setLoad(key, false);
  };

  const handleLoadUsers = async () => {
    setLoad('load_users', true);
    const res = await invoke('fetch_users');
    if (res.data?.success) {
      const users = res.data.users || [];
      const [existing, cleaners] = await Promise.all([
        base44.entities.HostawayUserCleanerMapping.filter({ business_id: BUSINESS_ID }),
        base44.entities.Cleaner.filter({ business_id: BUSINESS_ID }, 'cleaner_name', 200),
      ]);

      const existingByUserId = {};
      existing.forEach(m => { existingByUserId[m.hostaway_user_id] = m; });

      // Build cleaner lookup by email (lower) and by name (lower)
      const cleanerByEmail = {};
      const cleanerByName = {};
      cleaners.forEach(c => {
        if (c.email) cleanerByEmail[c.email.toLowerCase()] = c;
        if (c.cleaner_name) cleanerByName[c.cleaner_name.toLowerCase()] = c;
      });

      let created = 0, updated = 0, autoMapped = 0;
      for (const u of users) {
        // Try to auto-match to a cleaner
        const matchedCleaner =
          (u.email && cleanerByEmail[u.email.toLowerCase()]) ||
          (u.name && cleanerByName[u.name.toLowerCase()]);

        const ex = existingByUserId[u.id];
        if (!ex) {
          await base44.entities.HostawayUserCleanerMapping.create({
            business_id: BUSINESS_ID,
            hostaway_user_id: u.id,
            hostaway_user_name: u.name,
            hostaway_user_email: u.email,
            cleaner_id: matchedCleaner?.id || '',
            cleaner_name: matchedCleaner?.cleaner_name || '',
            qbo_vendor_name: matchedCleaner?.qbo_vendor_name || '',
            active: true,
          });
          created++;
          if (matchedCleaner) autoMapped++;
        } else {
          // Update name/email and auto-map cleaner if not already mapped
          const updates = {};
          if (ex.hostaway_user_name !== u.name) updates.hostaway_user_name = u.name;
          if (ex.hostaway_user_email !== u.email) updates.hostaway_user_email = u.email;
          if (!ex.cleaner_id && matchedCleaner) {
            updates.cleaner_id = matchedCleaner.id;
            updates.cleaner_name = matchedCleaner.cleaner_name;
            updates.qbo_vendor_name = matchedCleaner.qbo_vendor_name || '';
            autoMapped++;
          }
          if (Object.keys(updates).length > 0) {
            await base44.entities.HostawayUserCleanerMapping.update(ex.id, updates);
            updated++;
          }
        }
        // Also write hostaway_user_id back to the Cleaner record if missing
        if (matchedCleaner && !matchedCleaner.hostaway_user_id) {
          await base44.entities.Cleaner.update(matchedCleaner.id, { hostaway_user_id: u.id });
        }
      }
      toast.success(`Users loaded: ${created} new, ${updated} updated, ${autoMapped} auto-matched to cleaners.`);
      refetchMappings();
    } else {
      toast.error(res.data?.error || 'Failed to load users');
    }
    setLoad('load_users', false);
  };

  const handleFetchListings = async () => {
    setLoad('fetch_listings', true);
    const res = await invoke('fetch_listings');
    if (res.data?.success) {
      setFetchedListings(res.data.listings || []);
      // Refresh existing listings too so match logic is current
      const fresh = await base44.entities.Listing.filter({ business_id: BUSINESS_ID }, 'listing_name', 200);
      setExistingListings(fresh);
      toast.success(`Fetched ${res.data.listings.length} listings from Hostaway`);
    } else {
      toast.error(res.data?.error || 'Failed to fetch listings');
    }
    setLoad('fetch_listings', false);
  };

  const handleAddListing = async (listing) => {
    const created = await base44.entities.Listing.create({
      business_id: BUSINESS_ID,
      listing_name: listing.listing_name,
      hostaway_listing_id: listing.hostaway_listing_id,
      qbo_class_name: listing.qbo_class_name,
      owner_name: listing.owner_name,
      owner_id: listing.owner_id || '',
      notes: listing.notes,
      active: true,
    });
    setExistingListings(prev => [...prev, created]);
    toast.success(`Added "${listing.listing_name}" to Listings`);
  };

  const handleUpdateListingId = async (existingListing, hostawayId) => {
    await base44.entities.Listing.update(existingListing.id, { hostaway_listing_id: hostawayId });
    setExistingListings(prev => prev.map(l => l.id === existingListing.id ? { ...l, hostaway_listing_id: hostawayId } : l));
    toast.success(`Updated Hostaway ID for "${existingListing.listing_name}"`);
  };

  const handleAddCleanerFromMapping = async (mapping) => {
    if (!mapping.hostaway_user_name) { toast.error('No name available for this user'); return; }
    const code = mapping.hostaway_user_name.split(' ')[0].toUpperCase().slice(0, 8);
    const newCleaner = await base44.entities.Cleaner.create({
      business_id: BUSINESS_ID,
      cleaner_name: mapping.hostaway_user_name,
      cleaner_code: code,
      email: mapping.hostaway_user_email || '',
      hostaway_user_id: mapping.hostaway_user_id,
      active: true,
    });
    // Auto-update the mapping to point to new cleaner
    await base44.entities.HostawayUserCleanerMapping.update(mapping.id, {
      cleaner_id: newCleaner.id,
      cleaner_name: newCleaner.cleaner_name,
    });
    setCleanerOptions(prev => [...prev, newCleaner]);
    refetchMappings();
    toast.success(`Created cleaner "${newCleaner.cleaner_name}" and linked mapping`);
  };

  const handleAddAsOwner = async () => {
    if (!ownerDialogUser || ownerListingIds.length === 0) { toast.error('Select at least one listing'); return; }
    const ownerName = ownerDialogUser.hostaway_user_name || ownerDialogUser.hostaway_user_email || '';
    await Promise.all(ownerListingIds.map(id =>
      base44.entities.Listing.update(id, { owner_name: ownerName, owner_id: ownerDialogUser.hostaway_user_id })
    ));
    setExistingListings(prev => prev.map(l =>
      ownerListingIds.includes(l.id)
        ? { ...l, owner_name: ownerName, owner_id: ownerDialogUser.hostaway_user_id }
        : l
    ));
    toast.success(`Set "${ownerName}" as owner of ${ownerListingIds.length} listing(s)`);
    setOwnerDialogUser(null);
    setOwnerListingIds([]);
  };

  const handleSaveMapping = async (mapping, cleanerId) => {
    const cleaner = cleanerOptions.find(c => c.id === cleanerId);
    await base44.entities.HostawayUserCleanerMapping.update(mapping.id, {
      cleaner_id: cleanerId,
      cleaner_name: cleaner?.cleaner_name || '',
      qbo_vendor_name: cleaner?.qbo_vendor_name || '',
    });
    setEditingMapping(null);
    refetchMappings();
    toast.success('Mapping saved');
  };

  // has_valid_token is set server-side; access_token is never sent to the client
  const isTokenValid = setting?.has_valid_token === true;
  const hasMissingBusinessId = !BUSINESS_ID;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hostaway API Settings"
        description="Connect to Hostaway API to sync reservations and cleaning tasks directly"
      />

      {/* ── DEBUG PANEL (temporary) ── */}
      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="pt-4">
          <p className="text-xs font-bold text-amber-800 mb-2">🔍 DEBUG: User Identity (temporary — remove after confirming fix)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs font-mono">
            {[
              ['user.id', user?.id],
              ['user.email', user?.email],
              ['App role (resolved)', getAppRole(user)],
              ['user.business_id', user?.business_id],
              ['user.data?.business_id', user?.data?.business_id],
              ['user.data?.data?.business_id', user?.data?.data?.business_id],
              ['BUSINESS_ID (resolved)', BUSINESS_ID || '⚠️ EMPTY'],
            ].map(([label, val]) => (
              <div key={label} className="bg-white border border-amber-200 rounded px-2 py-1">
                <span className="text-amber-700">{label}: </span>
                <span className={!val ? 'text-red-600 font-bold' : 'text-gray-800'}>{String(val ?? 'undefined')}</span>
              </div>
            ))}
          </div>
          {hasMissingBusinessId && (
            <p className="mt-2 text-red-700 font-semibold text-xs">⚠️ BUSINESS_ID is blank — your user account is not linked to a business. Contact your admin.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Status Banner ── */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-4">
            <StatusPill status={setting?.connection_status || 'Not Configured'} />
            {setting?.last_error_message && (
              <span className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />{setting.last_error_message}
              </span>
            )}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground ml-auto">
              {setting?.last_token_refresh_at && <span>Token refreshed: {fmtDate(setting.last_token_refresh_at)}</span>}
              {setting?.last_reservation_sync_at && <span>Reservations: {fmtDate(setting.last_reservation_sync_at)}</span>}
              {setting?.last_task_sync_at && <span>Tasks: {fmtDate(setting.last_task_sync_at)}</span>}
            </div>
          </div>
          {isTokenValid && (
            <p className="mt-2 text-xs text-emerald-700">
              Token valid until: {fmtDate(setting.token_expires_at)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Credentials ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Plug className="w-4 h-4" />API Credentials</CardTitle>
          <CardDescription>Enter your Hostaway Account ID and API Key. The API key is sent to the server only — it is not stored in plain text in the app database.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Hostaway Account ID</Label>
              <Input value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="e.g. 12345" />
              {setting?.hostaway_account_id && (
                <p className="text-xs text-muted-foreground">Saved: {setting.hostaway_account_id}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Hostaway API Key (Client Secret)</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Enter API key — will not be shown after saving"
              />
              {setting?.hostaway_api_key_hint && (
                <p className="text-xs text-muted-foreground">Last saved key ends in: ...{setting.hostaway_api_key_hint}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" onClick={handleSaveCredentials} disabled={loading.save}>
              {loading.save ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save API Credentials
            </Button>
            <Button onClick={handleGetToken} disabled={loading.token}>
              {loading.token ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Get / Refresh Access Token
            </Button>
            <Button variant="outline" onClick={handleTestConnection} disabled={loading.test_conn || !isTokenValid}>
              {loading.test_conn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Date Range + Sync ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4" />Sync Date Range</CardTitle>
          <CardDescription>Sync reservations where checkout is in range (±7 day buffer applied automatically). Tasks sync by shouldEndBy date.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs text-primary/80 max-w-xl">
            <strong>Safe sync rules:</strong> Upsert only — existing CSV data is preserved. Manually edited fields are not overwritten. No payouts created automatically.
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => handleTestPull('reservations')} disabled={loading.test_res || !isTokenValid}>
              {loading.test_res ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              Test Small Reservation Pull (5)
            </Button>
            <Button variant="outline" onClick={() => handleTestPull('tasks')} disabled={loading.test_tasks || !isTokenValid}>
              {loading.test_tasks ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              Test Small Task Pull (5)
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleSync('reservations')} disabled={loading.sync_res || !isTokenValid}>
              {loading.sync_res ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Run Reservation Sync
            </Button>
            <Button onClick={() => handleSync('tasks')} disabled={loading.sync_tasks || !isTokenValid}>
              {loading.sync_tasks ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Run Task Sync
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── User Mapping ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Hostaway User Mapping</CardTitle>
              <CardDescription>Tasks use a numeric Hostaway User ID. Load users from the API to get their names, then map each to a cleaner or set as a property owner.</CardDescription>
            </div>
            <Button variant="outline" onClick={handleLoadUsers} disabled={loading.load_users || !isTokenValid}>
              {loading.load_users ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              Load Hostaway Users
            </Button>
          </div>
        </CardHeader>
          <CardContent>
            {mappings.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No users loaded yet. Click "Load Hostaway Users" to fetch users from the API.</p>
            )}
            {mappings.length > 0 && <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hostaway User ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Mapped Cleaner</TableHead>
                    <TableHead>Owner Of</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.hostaway_user_id}</TableCell>
                      <TableCell>{m.hostaway_user_name || '—'}</TableCell>
                      <TableCell>{m.hostaway_user_email || '—'}</TableCell>
                      <TableCell>
                        {m.cleaner_name
                          ? <span className="text-emerald-700 font-medium">{m.cleaner_name}</span>
                          : <span className="text-amber-600 text-xs font-medium">Not mapped</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {existingListings.filter(l => l.owner_id === m.hostaway_user_id).map(l => l.listing_name).join(', ') || '—'}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const isOwner = existingListings.some(l => l.owner_id === m.hostaway_user_id);
                          return (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Button size="sm" variant="outline" onClick={() => setEditingMapping(m)}>
                                {m.cleaner_id ? 'Change' : 'Map'}
                              </Button>
                              {!m.cleaner_id && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-primary border-primary/30 hover:bg-primary/5"
                                  onClick={() => handleAddCleanerFromMapping(m)}
                                  title="Create this person as a new Cleaner"
                                >
                                  <UserPlus className="w-3.5 h-3.5 mr-1" />
                                  Add as Cleaner
                                </Button>
                              )}
                              {!isOwner && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-violet-700 border-violet-300 hover:bg-violet-50"
                                  onClick={() => { setOwnerDialogUser(m); setOwnerListingIds([]); }}
                                  title="Set as owner of a listing"
                                >
                                  <Building2 className="w-3.5 h-3.5 mr-1" />
                                  Add as Owner
                                </Button>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>}
          </CardContent>
        </Card>

      {/* ── Listings Pull ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Listings from Hostaway</CardTitle>
              <CardDescription>Pull listings from Hostaway and selectively add them to your Listings table. Existing listings are never removed.</CardDescription>
            </div>
            <Button variant="outline" onClick={handleFetchListings} disabled={loading.fetch_listings || !isTokenValid}>
              {loading.fetch_listings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Fetch Listings
            </Button>
          </div>
        </CardHeader>
        {fetchedListings.length > 0 && (
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hostaway ID</TableHead>
                    <TableHead>Listing Name</TableHead>
                    <TableHead>Owner Name</TableHead>
                    <TableHead>Owner ID</TableHead>
                    <TableHead>In Listings Table</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fetchedListings.map(l => {
                    const exactMatch = existingListings.find(ex => ex.hostaway_listing_id === l.hostaway_listing_id);
                    const nameMatch = !exactMatch && existingListings.find(ex => ex.listing_name === l.listing_name);
                    const alreadyExists = exactMatch || nameMatch;
                    const needsIdUpdate = nameMatch && !nameMatch.hostaway_listing_id;
                    return (
                      <TableRow key={l.hostaway_listing_id}>
                        <TableCell className="font-mono text-xs">{l.hostaway_listing_id}</TableCell>
                        <TableCell className="font-medium">{l.listing_name}</TableCell>
                        <TableCell>{l.owner_name || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{l.owner_id || '—'}</TableCell>
                        <TableCell>
                          {exactMatch
                            ? <span className="text-emerald-700 text-xs font-medium">✓ Fully synced</span>
                            : nameMatch && !needsIdUpdate
                              ? <span className="text-emerald-700 text-xs font-medium">✓ In table</span>
                              : needsIdUpdate
                                ? <span className="text-amber-600 text-xs font-medium">Missing Hostaway ID</span>
                                : <span className="text-amber-600 text-xs font-medium">Not in table</span>}
                        </TableCell>
                        <TableCell>
                          {!alreadyExists && (
                            <Button size="sm" variant="outline" className="text-primary border-primary/30 hover:bg-primary/5" onClick={() => handleAddListing(l)}>
                              <PlusCircle className="w-3.5 h-3.5 mr-1" />Add to Listings
                            </Button>
                          )}
                          {needsIdUpdate && (
                            <Button size="sm" variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => handleUpdateListingId(nameMatch, l.hostaway_listing_id)}>
                              <RefreshCw className="w-3.5 h-3.5 mr-1" />Update ID
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Test Result Dialog ── */}
      <Dialog open={testResultOpen} onOpenChange={setTestResultOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Test Pull Results — {testResult?.type === 'reservations' ? 'Reservations' : 'Tasks'} ({testResult?.mapped?.length || 0} records)
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 mb-3">
            <Button size="sm" variant={testResultTab === 'mapped' ? 'default' : 'outline'} onClick={() => setTestResultTab('mapped')}>Mapped Fields</Button>
            <Button size="sm" variant={testResultTab === 'raw' ? 'default' : 'outline'} onClick={() => setTestResultTab('raw')}>Raw API Response</Button>
          </div>
          <div className="overflow-auto flex-1 rounded border bg-muted/30 p-3">
            {testResultTab === 'mapped' && testResult?.mapped && (
              <div className="space-y-3">
                {testResult.mapped.map((rec, i) => (
                  <div key={i} className="bg-white rounded border p-3 text-xs">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {Object.entries(rec)
                        .filter(([k]) => !k.includes('raw_json'))
                        .map(([k, v]) => (
                          <div key={k}>
                            <span className="font-medium text-muted-foreground">{k}: </span>
                            <span className="font-mono">{String(v ?? '')}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {testResultTab === 'raw' && (
              <pre className="text-xs whitespace-pre-wrap font-mono">{JSON.stringify(testResult?.raw, null, 2)}</pre>
            )}
          </div>
          <div className="pt-3 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTestResultOpen(false)}>Close</Button>
            <Button onClick={handleSaveTestResults} disabled={loading.save_test}>
              {loading.save_test ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Save Test Results to Database
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add as Owner Dialog ── */}
      <Dialog open={!!ownerDialogUser} onOpenChange={v => !v && setOwnerDialogUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set as Property Owner</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Select all listings owned by <strong>{ownerDialogUser?.hostaway_user_name}</strong>.
            </p>
            <Label>Select Listings</Label>
            <div className="border rounded-md divide-y max-h-60 overflow-y-auto">
              {existingListings.map(l => (
                <label key={l.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={ownerListingIds.includes(l.id)}
                    onChange={e => setOwnerListingIds(prev =>
                      e.target.checked ? [...prev, l.id] : prev.filter(id => id !== l.id)
                    )}
                  />
                  <span className="flex-1">{l.listing_name}</span>
                  {l.owner_name && <span className="text-xs text-muted-foreground">{l.owner_name}</span>}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{ownerListingIds.length} selected</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOwnerDialogUser(null)}>Cancel</Button>
              <Button onClick={handleAddAsOwner} disabled={ownerListingIds.length === 0}>Save Owner</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Mapping Edit Dialog ── */}
      <Dialog open={!!editingMapping} onOpenChange={v => !v && setEditingMapping(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Map Hostaway User to Cleaner</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Hostaway User ID: <strong>{editingMapping?.hostaway_user_id}</strong></p>
            <Label>Select Cleaner</Label>
            <select
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              defaultValue={editingMapping?.cleaner_id || ''}
              onChange={e => handleSaveMapping(editingMapping, e.target.value)}
            >
              <option value="">— Select cleaner —</option>
              {cleanerOptions.map(c => (
                <option key={c.id} value={c.id}>{c.cleaner_name} {c.cleaner_code ? `(${c.cleaner_code})` : ''}</option>
              ))}
            </select>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}