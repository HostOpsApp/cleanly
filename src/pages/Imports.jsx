import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId } from '@/lib/roles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, FileText, Loader2, CheckCircle2, Trash2, Info } from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { parseCSV, normalizeReservationKey, normalizeDate, col } from '@/lib/csvParser';
import { toast } from 'sonner';

// ─── Pay Period Helpers ───────────────────────────────────────────────────────

/** Derive YYYYMM + 001/002 from a YYYY-MM-DD date string */
function detectPayPeriod(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, year, mo, day] = m;
  return { month: `${year}${mo}`, number: parseInt(day) <= 14 ? '001' : '002' };
}

function periodLabel(month, number) {
  if (!month) return '—';
  const year = month.substring(0, 4);
  const mo = month.substring(4, 6);
  const half = number === '001' ? '1–14' : '15–end';
  return `${year}-${mo} (${half})`;
}

// ─── QBO helpers (also used in importQboLines) ───────────────────────────────

function deriveQboReservationKey(num) {
  if (!num) return '';
  const trimmed = num.trim();
  const hmMatch = trimmed.match(/HM\w{8}/i);
  if (hmMatch) return hmMatch[0].toUpperCase();
  if (/^HM/i.test(trimmed) && trimmed.length >= 10) return trimmed.substring(0, 10).toUpperCase();
  return trimmed;
}

function extractCheckoutFromDescription(description) {
  if (!description) return '';
  const parts = description.split('|');
  if (parts.length >= 2) {
    const segment = parts[1].trim();
    const rangeMatch = segment.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
    if (rangeMatch) return rangeMatch[2];
    if (/^\d{4}-\d{2}-\d{2}$/.test(segment)) return segment;
  }
  return '';
}

function classifyQboFeeTypeDetailed(description) {
  if (!description) return { feeType: 'Error / Needs Review', isCleaning: false, isPet: false, isError: true };
  const d = description.trim().toLowerCase();
  if (d.startsWith('cleaning') || d.includes('cleaning fee'))
    return { feeType: 'Cleaning Fee', isCleaning: true, isPet: false, isError: false };
  if (d.startsWith('pet') || d.includes('pet fee'))
    return { feeType: 'Pet Fee', isCleaning: false, isPet: true, isError: false };
  return { feeType: 'Error / Needs Review', isCleaning: false, isPet: false, isError: true };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Imports() {
  const { user } = useAuth();
  const BUSINESS_ID = getBusinessId(user);
  const qc = useQueryClient();
  const [files, setFiles] = useState({ reservations: null, tasks: null, qbo: null });
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ reservations: null, tasks: null, qbo: null });
  const [detectedPeriods, setDetectedPeriods] = useState(null); // {reservations?, tasks?, qbo?}
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);
  
  const handleDeleteAll = async () => {
    if (!BUSINESS_ID) {
      toast.error('User is not linked to a business. Cannot delete import data.');
      return;
    }

    const confirmed = confirm(
      'Delete ALL import batches and associated data for this business only? This cannot be undone.'
    );

    if (!confirmed) return;

    setDeletingAll(true);

    try {
      const [allTasks, allReservations, allQbo, allBatches] = await Promise.all([
        base44.entities.CleaningTask.filter(
          { business_id: BUSINESS_ID },
          '-created_date',
          2000
        ),

        base44.entities.Reservation.filter(
          { business_id: BUSINESS_ID },
          '-created_date',
          2000
        ),

        base44.entities.QboCleanerRevenueLine.filter(
          { business_id: BUSINESS_ID },
          '-created_date',
          2000
        ),

        base44.entities.ImportBatch.filter(
          { business_id: BUSINESS_ID },
          '-created_date',
          500
        ),
      ]);

      const deleteAll = async (entity, items = []) => {
        for (let i = 0; i < items.length; i += 20) {
          await Promise.all(
            items.slice(i, i + 20).map((item) => entity.delete(item.id))
          );

          if (i + 20 < items.length) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
    };

    await deleteAll(base44.entities.CleaningTask, allTasks);
    await deleteAll(base44.entities.Reservation, allReservations);
    await deleteAll(base44.entities.QboCleanerRevenueLine, allQbo);
    await deleteAll(base44.entities.ImportBatch, allBatches);

      qc.invalidateQueries();
      toast.success('All import data for this business was cleared successfully.');
    } catch (err) {
      console.error('Delete all failed:', err);
      toast.error(`Delete all failed: ${err.message}`);
    } finally {
      setDeletingAll(false);
    }
  };

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['importBatches', BUSINESS_ID],
    enabled: Boolean(BUSINESS_ID),
    queryFn: () => 
      base44.entities.ImportBatch.filter(
        { business_id: BUSINESS_ID },
       '-created_date', 
       50
      ),
    initialData: [],
  });

  // ── File selection + period preview ────────────────────────────────────────
  const handleFileChange = async (fileKey, file) => {
    setFiles(f => ({ ...f, [fileKey]: file || null }));
    if (!file) {
      setDetectedPeriods(p => ({ ...p, [fileKey]: null }));
      return;
    }
    // Peek at the file to detect periods
    const text = await file.text();
    let rows = parseCSV(text);
    if (fileKey === 'qbo') {
      const lines = text.split(/\r?\n/);
      const headerLineIdx = lines.findIndex(l => l.trim().startsWith('Date'));
      if (headerLineIdx > 0) rows = parseCSV(lines.slice(headerLineIdx).join('\n'));
    }
    const periods = new Set();
    rows.forEach(r => {
      let checkoutDate = '';
      if (fileKey === 'reservations') {
        checkoutDate = normalizeDate(col(r,
          'Check-out Date', 'Check-Out Date', 'Check Out Date', 'checkOutDate', 'Departure Date', 'Checkout Date'
        ));
      } else if (fileKey === 'tasks') {
        // Tasks don't carry checkout date directly — use can_start_from as proxy
        checkoutDate = normalizeDate(col(r, 'Can Start from').split(' ')[0]);
      } else if (fileKey === 'qbo') {
        const desc = col(r, 'Product/Service description', 'Description', 'description', 'Memo', 'Product/Service');
        checkoutDate = extractCheckoutFromDescription(desc);
      }
      const pp = detectPayPeriod(checkoutDate);
      if (pp) periods.add(`${pp.month}|${pp.number}`);
    });
    const sorted = Array.from(periods).sort();
    setDetectedPeriods(p => ({ ...(p || {}), [fileKey]: sorted }));
  };

  // ── Batch delete ────────────────────────────────────────────────────────────
const handleDeleteBatch = async (batch) => {
  if (!BUSINESS_ID) {
    toast.error('User is not linked to a business. Cannot delete batch.');
    return;
  }

  if (!batch?.id) {
    toast.error('Missing batch ID. Cannot delete batch.');
    return;
  }

  if (batch.business_id && batch.business_id !== BUSINESS_ID) {
    toast.error('This batch does not belong to your business.');
    return;
  }

  const confirmed = confirm(
    `Delete batch "${batch.batch_name}" and all its imported records? This cannot be undone.`
  );

  if (!confirmed) return;

  setDeletingBatch(batch.id);

  const deleteAll = async (entity, items = []) => {
    for (let i = 0; i < items.length; i += 20) {
      await Promise.all(
        items.slice(i, i + 20).map((item) => entity.delete(item.id))
      );

      if (i + 20 < items.length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  };

  try {
    if (batch.import_type === 'Hostaway Tasks') {
      const items = await base44.entities.CleaningTask.filter({
        business_id: BUSINESS_ID,
        source_batch_id: batch.id,
      });

      await deleteAll(base44.entities.CleaningTask, items);
    }

    if (batch.import_type === 'Hostaway Reservations') {
      const items = await base44.entities.Reservation.filter({
        business_id: BUSINESS_ID,
        source_batch_id: batch.id,
      });

      await deleteAll(base44.entities.Reservation, items);
    }

    if (batch.import_type === 'QBO Cleaner Revenue') {
      const items = await base44.entities.QboCleanerRevenueLine.filter({
        business_id: BUSINESS_ID,
        import_batch_id: batch.id,
      });

      await deleteAll(base44.entities.QboCleanerRevenueLine, items);
    }

    await base44.entities.ImportBatch.delete(batch.id);

    qc.invalidateQueries();
    toast.success(`Batch "${batch.batch_name}" deleted`);
  } catch (err) {
    console.error('Delete batch failed:', err);
    toast.error(`Delete failed: ${err.message}`);
  } finally {
    setDeletingBatch(null);
  }
};

  // ── Main import orchestration ───────────────────────────────────────────────
  const handleImportAll = async () => {
    if (!BUSINESS_ID) {
      toast.error('User is not linked to a business. Cannot import CSV data.');
      return;
    }

    console.log('CSV Import BUSINESS_ID:', BUSINESS_ID);
    setImporting(true);
    setImportProgress({ reservations: null, tasks: null, qbo: null });
    try {
      if (files.reservations) {
        setImportProgress(p => ({ ...p, reservations: 'loading' }));
        const text = await files.reservations.text();
        const rows = parseCSV(text).filter(r => {
          const id = col(r, 'Reservation ID', 'reservationId', 'Id', 'ID');
          return id && id !== '0';
        });
        const count = await importReservations(rows, files.reservations.name, format(new Date(), 'yyyy-MM-dd HH:mm'), BUSINESS_ID);
        toast.success(`Reservations: ${count} rows imported`);
        setImportProgress(p => ({ ...p, reservations: 'done' }));
      }

      if (files.tasks) {
        setImportProgress(p => ({ ...p, tasks: 'loading' }));
        const text = await files.tasks.text();
        const rows = parseCSV(text);
        const count = await importTasks(rows, files.tasks.name, format(new Date(), 'yyyy-MM-dd HH:mm'), BUSINESS_ID
        );
        toast.success(`Tasks: ${count} rows imported`);
        setImportProgress(p => ({ ...p, tasks: 'done' }));
      }

      if (files.qbo) {
        setImportProgress(p => ({ ...p, qbo: 'loading' }));
        const text = await files.qbo.text();
        let rows = parseCSV(text);
        const lines = text.split(/\r?\n/);
        const headerLineIdx = lines.findIndex(l => l.trim().startsWith('Date'));
        if (headerLineIdx > 0) rows = parseCSV(lines.slice(headerLineIdx).join('\n'));

        const count = await importQboLines(rows, files.qbo.name, format(new Date(), 'yyyy-MM-dd HH:mm'), BUSINESS_ID
        );
        toast.success(`QBO Revenue: ${count} rows imported across all detected periods`);
        setImportProgress(p => ({ ...p, qbo: 'done' }));
      }

      qc.invalidateQueries();
      setDialogOpen(false);
      setFiles({ reservations: null, tasks: null, qbo: null });
      setDetectedPeriods(null);
      setImportProgress({ reservations: null, tasks: null, qbo: null });
    } catch (err) {
      toast.error(`Import failed: ${err.message}`);
    }
    setImporting(false);
  };

  const hasAnyFile = files.reservations || files.tasks || files.qbo;

  const FileSlot = ({ label, description, fileKey, step }) => {
    const file = files[fileKey];
    const status = importProgress[fileKey];
    const periods = detectedPeriods?.[fileKey];
    return (
      <div className={`border rounded-lg p-4 transition-colors ${file ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium bg-muted text-muted-foreground rounded-full w-5 h-5 flex items-center justify-center">{step}</span>
              <Label className="font-semibold text-sm">{label}</Label>
              {status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
              {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
              {status === 'error' && <span className="text-xs text-destructive font-medium">Error</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 ml-7">{description}</p>
          </div>
          {file && <span className="text-xs text-primary font-medium truncate max-w-[140px]">{file.name}</span>}
        </div>
        <Input
          type="file"
          accept=".csv"
          disabled={importing}
          onChange={(e) => handleFileChange(fileKey, e.target.files?.[0] || null)}
          className="mt-1 text-xs"
        />
        {periods && periods.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 items-center">
            <Info className="w-3 h-3 text-primary/70" />
            <span className="text-[11px] text-muted-foreground">Detected periods:</span>
            {periods.map(p => {
              const [mo, num] = p.split('|');
              return (
                <span key={p} className="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                  {periodLabel(mo, num)}
                </span>
              );
            })}
          </div>
        )}
        {periods && periods.length === 0 && file && (
          <p className="mt-1 text-[11px] text-amber-600">⚠ No checkout dates detected — period will be recorded as Unknown</p>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Import Batches"
        description="Upload CSV files from Hostaway and QuickBooks — pay periods are auto-detected from checkout dates"
        actions={
          <>
          <Button variant="destructive" size="sm" onClick={handleDeleteAll} disabled={deletingAll || batches.length === 0}>
            {deletingAll ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Clearing...</> : <><Trash2 className="w-4 h-4 mr-2" />Delete All</>}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Upload className="w-4 h-4 mr-2" />Upload CSV Files</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Import Data</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-primary/80 flex gap-2">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Pay periods are automatically detected from checkout dates in each file — no manual selection needed. Files spanning multiple periods will be split automatically.
                </div>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Select files to import (any or all)</p>
                  <FileSlot step="1" label="Hostaway Reservations" description="Reservation export CSV — must be imported first" fileKey="reservations" />
                  <FileSlot step="2" label="Hostaway Tasks" description="Cleaning task export CSV — import after reservations" fileKey="tasks" />
                  <FileSlot step="3" label="QBO Cleaner Revenue" description="QuickBooks cleaner revenue CSV — import last" fileKey="qbo" />
                </div>
                <Button onClick={handleImportAll} disabled={!hasAnyFile || importing} className="w-full">
                  {importing
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
                    : <><Upload className="w-4 h-4 mr-2" />Import Selected Files</>}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      <div className="bg-card rounded-xl border overflow-x-auto">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow>
              <TableHead>Batch Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : batches.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No imports yet. Upload a CSV to get started.</TableCell></TableRow>
            ) : batches.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium text-sm">{b.batch_name}</TableCell>
                <TableCell className="text-sm">{b.import_type}</TableCell>
                <TableCell className="text-sm font-mono">{b.pay_period_month ? `${b.pay_period_month}-${b.pay_period_number}` : 'Multi-period'}</TableCell>
                <TableCell className="text-sm"><div className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-muted-foreground" />{b.uploaded_file_name}</div></TableCell>
                <TableCell className="text-sm">{b.row_count}</TableCell>
                <TableCell><StatusBadge status={b.status} /></TableCell>
                <TableCell className="text-sm text-muted-foreground">{b.created_date ? format(new Date(b.created_date), 'MMM d, HH:mm') : ''}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteBatch(b)} disabled={deletingBatch === b.id}>
                    {deletingBatch === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Import Functions ─────────────────────────────────────────────────────────

async function importReservations(rows, fileName, timestamp, businessId) {
  // Filter out inquiry status rows upfront
  if (!businessId) {
    throw new Error('Missing business_id. Cannot import reservations.');
  }
  const filteredRows = rows.filter(r => {
    const status = col(r, 'Status', 'Reservation Status').trim().toLowerCase();
    return status !== 'inquiry';
  });

  // Group rows by detected pay period
  const periodGroups = {};
  filteredRows.forEach(r => {
    const extId = col(r, 'External Reservation ID', 'externalReservationId', 'Airbnb Confirmation Code', 'Confirmation Code');
    const resId = col(r, 'Reservation ID', 'reservationId', 'Id', 'ID');
    const checkoutRaw = col(r, 'Check-out Date', 'Check-Out Date', 'Check Out Date', 'checkOutDate', 'Departure Date', 'Checkout Date');
    const checkoutDate = normalizeDate(checkoutRaw);
    const pp = detectPayPeriod(checkoutDate) || { month: 'unknown', number: '001' };
    const periodKey = `${pp.month}|${pp.number}`;

    if (!periodGroups[periodKey]) periodGroups[periodKey] = [];
    periodGroups[periodKey].push({ r, extId, resId, checkoutDate, pp });
  });

  // Load existing reservations for upsert
  const existingReservations = await base44.entities.Reservation.filter(
    { business_id: businessId },
    '-created_date', 2000
  );
  const existingByResId = {};
  existingReservations.forEach(res => {
    if (res.reservation_id) existingByResId[String(res.reservation_id).trim()] = res;
  });

  let totalProcessed = 0;
  const periodEntries = Object.entries(periodGroups);
  for (let pi = 0; pi < periodEntries.length; pi++) {
    const [periodKey, group] = periodEntries[pi];
    if (pi > 0) await new Promise(res => setTimeout(res, 500));
    const [mo, num] = periodKey.split('|');
    
    const batch = await base44.entities.ImportBatch.create({
      business_id: businessId,
      batch_name: `Hostaway Reservations - ${timestamp} [${periodLabel(mo, num)}]`,
      pay_period_month: mo === 'unknown' ? '' : mo,
      pay_period_number: mo === 'unknown' ? '' : num,
      import_type: 'Hostaway Reservations',
      uploaded_file_name: fileName,
      status: 'Processing',
      row_count: group.length,
    });

    const records = group.map(({ r, extId, resId, checkoutDate }) => {
      const channel = col(r, 'Channel', 'Source', 'Booking Channel', 'Platform');
      const channelResId = col(r, 'Channel Reservation ID', 'channelReservationId', 'Channel Res ID', 'Booking Code');
      return {
        reservation_id: resId,
        business_id: businessId,
        external_reservation_id: extId,
        channel_reservation_id: channelResId,
        listing_name: col(r, 'Listing Name', 'listingName', 'Listing', 'Property'),
        hostaway_listing_id: col(r, 'Listing ID', 'listingId', 'listingMapId', 'Property ID'),
        guest_name: col(r, 'Guest Name', 'guestName', 'Guest', 'Name'),
        check_in_date: normalizeDate(col(r, 'Check-in Date', 'Check-In Date', 'Check In Date', 'checkInDate', 'Arrival Date', 'Arrival', 'Checkin Date')),
        check_out_date: checkoutDate,
        reservation_created_date: normalizeDate(col(r, 'Reservation Date', 'Created Date', 'Created', 'createdDate', 'Booking Date', 'Date Created', 'Date Booked', 'Date')),
        reservation_date: normalizeDate(col(r, 'Reservation Date', 'reservationDate', 'Date')),
        cleaning_fee_value: parseFloat(col(r, 'Cleaning Fee Value', 'Cleaning Fee', 'cleaningFeeValue').replace(/[$,]/g, '')) || 0,
        pet_fee_value: parseFloat(col(r, 'Cleaner Pet Fee', 'Pet Fee Value', 'Pet Fee', 'petFee').replace(/[$,]/g, '')) || 0,
        channel,
        status: col(r, 'Status', 'Reservation Status'),
        normalized_reservation_key: normalizeReservationKey(extId, resId, channel, channelResId),
        source_batch_id: batch.id,
      };
    });

    // Upsert — only create new or update changed records
    const toCreate = [], toUpdate = [];
    for (const rec of records) {
      const existing = existingByResId[rec.reservation_id];
      if (!existing) {
        toCreate.push(rec);
      } else {
        const changed = existing.status !== rec.status ||
          existing.check_out_date !== rec.check_out_date ||
          existing.check_in_date !== rec.check_in_date ||
          existing.cleaning_fee_value !== rec.cleaning_fee_value ||
          existing.pet_fee_value !== rec.pet_fee_value ||
          existing.normalized_reservation_key !== rec.normalized_reservation_key;
        if (changed) toUpdate.push({ id: existing.id, data: rec });
      }
    }

    const chunkSize = 20;
    for (let i = 0; i < toCreate.length; i += chunkSize) {
      await base44.entities.Reservation.bulkCreate(toCreate.slice(i, i + chunkSize));
      if (i + chunkSize < toCreate.length) await new Promise(res => setTimeout(res, 300));
    }
    for (let i = 0; i < toUpdate.length; i += chunkSize) {
      await Promise.all(toUpdate.slice(i, i + chunkSize).map(u => base44.entities.Reservation.update(u.id, u.data)));
      if (i + chunkSize < toUpdate.length) await new Promise(res => setTimeout(res, 300));
    }

    await base44.entities.ImportBatch.update(batch.id, { status: 'Completed', row_count: records.length });
    totalProcessed += records.length;
  }
  return totalProcessed;
}

async function importTasks(rows, fileName, timestamp, businessId) {
  if (!businessId) {
    throw new Error('Missing business_id. Cannot import tasks.');
  }

  const [reservations, cleaners] = await Promise.all([
    base44.entities.Reservation.filter({ business_id: businessId }, '-created_date', 2000),
    base44.entities.Cleaner.filter({ business_id: businessId }, 'cleaner_name', 200),
  ]);

  const resByResId = {};
  reservations.forEach(r => {
    if (r.reservation_id) resByResId[String(r.reservation_id).trim()] = r;
    if (r.normalized_reservation_key) resByResId[String(r.normalized_reservation_key).trim()] = r;
  });

  const cleanerByName = {};
  const cleanerByEmail = {};
  cleaners.forEach(c => {
    if (c.cleaner_name) cleanerByName[c.cleaner_name.trim().toLowerCase()] = c;
    if (c.email) cleanerByEmail[c.email.trim().toLowerCase()] = c;
  });

  const existingQboKeys = new Set(
    (await base44.entities.QboCleanerRevenueLine.filter({ business_id: businessId }, '-created_date', 2000))
      .map(q => q.normalized_reservation_key || q.num).filter(Boolean)
  );

  // Group rows by pay period (from can_start_from date as proxy)
  const periodGroups = {};
  rows.forEach(r => {
    const canStartRaw = col(r, 'Can Start from');
    const dateStr = normalizeDate(canStartRaw.split(' ')[0] || canStartRaw);
    const pp = detectPayPeriod(dateStr) || { month: 'unknown', number: '001' };
    const key = `${pp.month}|${pp.number}`;
    if (!periodGroups[key]) periodGroups[key] = [];
    periodGroups[key].push(r);
  });

  // Fetch existing tasks ONCE outside the loop
  const existingTasksAll = await base44.entities.CleaningTask.filter({ business_id: businessId }, '-created_date', 2000);
  const existingByTaskId = {};
  existingTasksAll.forEach(t => { if (t.task_id) existingByTaskId[t.task_id] = t; });

  let totalProcessed = 0;
  const periodEntries = Object.entries(periodGroups);
  for (let pi = 0; pi < periodEntries.length; pi++) {
    const [periodKey, group] = periodEntries[pi];
    if (pi > 0) await new Promise(res => setTimeout(res, 500));
    const [mo, num] = periodKey.split('|');
    
    const batch = await base44.entities.ImportBatch.create({
      business_id: businessId,
      batch_name: `Hostaway Tasks - ${timestamp} [${periodLabel(mo, num)}]`,
      pay_period_month: mo === 'unknown' ? '' : mo,
      pay_period_number: mo === 'unknown' ? '' : num,
      import_type: 'Hostaway Tasks',
      uploaded_file_name: fileName,
      status: 'Processing',
      row_count: group.length,
    });

    const records = group.map(r => {
      const taskId = col(r, 'Task ID');
      const resIdRaw = col(r, 'Reservation', 'Reservation ID', 'reservation_id', 'reservationId', 'Res ID', 'ResID');
      const resId = String(resIdRaw).trim();
      const canStartRaw = col(r, 'Can Start from');
      const canStartDate = normalizeDate(canStartRaw.split(' ')[0] || canStartRaw);
      const assigneeRaw = col(r, 'Assignee user').trim();
      const assigneeEmailMatch = assigneeRaw.match(/\S+@\S+/);
      const assigneeEmail = assigneeEmailMatch ? assigneeEmailMatch[0].toLowerCase() : '';
      const assigneeName = assigneeRaw.replace(/\S+@\S+/g, '').trim().toLowerCase();
      const matchedReservation = resByResId[resId];
      const resolvedResId = matchedReservation?.reservation_id || resId;
      const normKey = matchedReservation?.normalized_reservation_key || normalizeReservationKey('', resId);
      const matchedCleaner = cleanerByName[assigneeName] || cleanerByEmail[assigneeEmail] || null;
      const taskStatus = col(r, 'Status');
      const isCancelled = taskStatus.trim().toLowerCase() === 'cancelled' || taskStatus.trim().toLowerCase() === 'canceled';
      const hasAssignee = assigneeRaw.length > 0;
      const hasQboMatch = existingQboKeys.has(normKey) || existingQboKeys.has(resId);
      if (isCancelled && !hasAssignee && !hasQboMatch) return null;
      return {
        task_id: taskId,
        reservation_id: resolvedResId,
        business_id: businessId,
        task_title: col(r, 'Title'),
        status: taskStatus,
        channel: col(r, 'Channel'),
        assignee_user: assigneeRaw,
        supervisor_user: col(r, 'Supervisor user'),
        can_start_from: canStartDate,
        cost: parseFloat(col(r, 'Cost').replace(/[$,]/g, '')) || 0,
        normalized_reservation_key: normKey,
        cleaner_id: matchedCleaner?.id || '',
        cleaner_name: matchedCleaner?.cleaner_name || '',
        cleaner_code: matchedCleaner?.cleaner_code || '',
        source_batch_id: batch.id,
      };
    }).filter(Boolean);

    // Upsert — uses existingByTaskId populated once before the loop
    const toCreate = [], toUpdate = [];
    for (const rec of records) {
      const existing = existingByTaskId[rec.task_id];
      if (!existing) {
        toCreate.push(rec);
      } else {
        const changed = existing.cost !== rec.cost || existing.status !== rec.status ||
          existing.assignee_user !== rec.assignee_user || existing.normalized_reservation_key !== rec.normalized_reservation_key;
        if (changed) toUpdate.push({ id: existing.id, data: rec });
      }
    }
    const chunkSize = 20;
    for (let i = 0; i < toCreate.length; i += chunkSize) {
      await base44.entities.CleaningTask.bulkCreate(toCreate.slice(i, i + chunkSize));
      if (i + chunkSize < toCreate.length) await new Promise(res => setTimeout(res, 300));
    }
    for (let i = 0; i < toUpdate.length; i += chunkSize) {
      await Promise.all(toUpdate.slice(i, i + chunkSize).map(u => base44.entities.CleaningTask.update(u.id, u.data)));
      if (i + chunkSize < toUpdate.length) await new Promise(res => setTimeout(res, 300));
    }

    await base44.entities.ImportBatch.update(batch.id, { status: 'Completed', row_count: records.length });
    totalProcessed += records.length;
  }
  return totalProcessed;
}

async function importQboLines(rows, fileName, timestamp, businessId) {
  if (!businessId) {
  throw new Error('Missing business_id. Cannot import QBO cleaner revenue.');
  }
  const [reservations, tasks, listings, rates, cleaners, settings] = await Promise.all([
    base44.entities.Reservation.filter(
      { business_id: businessId },
      '-created_date',
      1000
    ),

    base44.entities.CleaningTask.filter(
      { business_id: businessId },
      '-created_date',
      1000
    ),

    base44.entities.Listing.filter(
      { business_id: businessId },
      'listing_name',
      500
    ),

    base44.entities.ListingCleaningRate.filter(
      { business_id: businessId },
      '-effective_date',
      500
    ),

    base44.entities.Cleaner.filter(
      { business_id: businessId },
      'cleaner_name',
      500
    ),

    base44.entities.AppSetting.filter(
      { business_id: businessId }
    ),
  ]);

  const getSettingVal = (key, def) => {
    const s = settings.find(s => s.setting_key === key);
    return s ? parseFloat(s.setting_value) : def;
  };
  const diffThreshold = getSettingVal('cleaning_fee_diff_threshold', 5.00);
  const diffTolerance = getSettingVal('cleaning_fee_diff_tolerance', 5.10);
  const petPct = getSettingVal('pet_fee_payout_pct', 50);

  const resByKey = {};
  reservations.forEach(r => {
    if (r.normalized_reservation_key) resByKey[r.normalized_reservation_key] = r;
    if (r.reservation_id) resByKey[r.reservation_id] = r;
  });
  const tasksByKey = {};
  tasks.forEach(t => {
    const k = t.normalized_reservation_key || t.reservation_id;
    if (k) { if (!tasksByKey[k]) tasksByKey[k] = []; tasksByKey[k].push(t); }
  });
  const listingByClass = {};
  const listingByName = {};
  listings.forEach(l => {
    if (l.qbo_class_name) listingByClass[l.qbo_class_name.trim().toLowerCase()] = l;
    if (l.listing_name) listingByName[l.listing_name.trim().toLowerCase()] = l;
  });
  const ratesByListing = {};
  rates.forEach(rt => {
    if (!ratesByListing[rt.listing_id]) ratesByListing[rt.listing_id] = [];
    ratesByListing[rt.listing_id].push(rt);
  });
  Object.keys(ratesByListing).forEach(k => {
    ratesByListing[k].sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || ''));
  });
  const cleanerById = {};
  cleaners.forEach(c => { cleanerById[c.id] = c; });

  const findExpectedRate = (listingId, reservationCreatedDate) => {
    const listingRates = ratesByListing[listingId];
    if (!listingRates || listingRates.length === 0) return null;
    if (!reservationCreatedDate) return listingRates[0];
    for (const rate of listingRates) {
      if (rate.effective_date <= reservationCreatedDate) return rate;
    }
    return null;
  };

  // ── Group rows by auto-detected pay period ──────────────────────────────────
  const periodGroups = {};
  const seenCleaningKeys = new Set();
  const seenPetKeys = new Set();

  rows.forEach(r => {
    const desc = col(r, 'Product/Service description', 'Description', 'description', 'Memo', 'Product/Service');
    const numRaw = col(r, 'Num', 'num').trim();
    const normKey = deriveQboReservationKey(numRaw);
    const matchedReservation = resByKey[normKey] || resByKey[numRaw] || null;
    const checkoutDate = extractCheckoutFromDescription(desc) || matchedReservation?.check_out_date || '';
    const pp = detectPayPeriod(checkoutDate) || { month: 'unknown', number: '001' };
    const periodKey = `${pp.month}|${pp.number}`;
    if (!periodGroups[periodKey]) periodGroups[periodKey] = [];
    periodGroups[periodKey].push(r);
  });

  // Load existing QBO lines for upsert
  const existingQbo = await base44.entities.QboCleanerRevenueLine.filter({ business_id: businessId }, '-created_date', 2000);
  const existingQboByKey = {};
  existingQbo.forEach(q => { existingQboByKey[`${q.num}||${q.fee_type}`] = q; });

  let totalImported = 0;

  const qboPeriodEntries = Object.entries(periodGroups);
  for (let pi = 0; pi < qboPeriodEntries.length; pi++) {
    const [periodKey, group] = qboPeriodEntries[pi];
    if (pi > 0) await new Promise(res => setTimeout(res, 500));
    const [mo, num] = periodKey.split('|');
    const batch = await base44.entities.ImportBatch.create({
      business_id: businessId,
      batch_name: `QBO Cleaner Revenue - ${timestamp} [${periodLabel(mo, num)}]`,
      pay_period_month: mo === 'unknown' ? '' : mo,
      pay_period_number: mo === 'unknown' ? '' : num,
      import_type: 'QBO Cleaner Revenue',
      uploaded_file_name: fileName,
      status: 'Processing',
      row_count: group.length,
    });

    const records = group.map(r => {
      const dateRaw = col(r, 'Date', 'date');
      const qboDate = normalizeDate(dateRaw);
      const itemClass = col(r, 'Item Class', 'item_class', 'Class', 'class');
      const distributionAccount = col(r, 'Distribution Account', 'distribution_account', 'Account');
      const numRaw = col(r, 'Num', 'num').trim();
      const guest = col(r, 'Guest', 'guest', 'Name', 'Customer Name');
      const desc = col(r, 'Product/Service description', 'Description', 'description', 'Memo', 'Product/Service');
      const amountRaw = col(r, 'Product/service amount line', 'product_service_amount_line', 'Amount', 'amount', 'Line Amount');
      const createdOnLine = col(r, 'Product/Service created on date line', 'Created Date', 'Created');

      const { feeType, isCleaning, isPet, isError } = classifyQboFeeTypeDetailed(desc);

      let amountLine = 0, amountError = false;
      if (!amountRaw || amountRaw.trim() === '') {
        amountError = true;
      } else {
        const parsed = parseFloat(amountRaw.replace(/[$,\s()]/g, ''));
        if (isNaN(parsed)) amountError = true;
        else amountLine = parsed;
      }

      const normKey = deriveQboReservationKey(numRaw);
      const matchedListing = itemClass ? listingByClass[itemClass.trim().toLowerCase()] || null : null;
      const matchedReservation = resByKey[normKey] || resByKey[numRaw] || null;
      const taskMatches = tasksByKey[normKey] || tasksByKey[numRaw] || [];
      const matchedTask = taskMatches.length > 0 ? taskMatches[0] : null;

      let matchedCleaner = null;
      if (matchedTask?.cleaner_id) matchedCleaner = cleanerById[matchedTask.cleaner_id] || null;
      if (!matchedCleaner && matchedListing?.default_cleaner_id)
        matchedCleaner = cleanerById[matchedListing.default_cleaner_id] || null;

      const expectedRate = matchedListing
        ? findExpectedRate(matchedListing.id, matchedReservation?.reservation_created_date)
        : null;

      let isDuplicate = false;
      if (isCleaning) {
        if (seenCleaningKeys.has(normKey)) isDuplicate = true;
        else seenCleaningKeys.add(normKey);
      }
      if (isPet) {
        if (seenPetKeys.has(normKey)) isDuplicate = true;
        else seenPetKeys.add(normKey);
      }

      let recommendedPayout = 0;
      let recommendedExpenseAccount = matchedCleaner?.default_expense_account || 'Contract labor:Rental Cleanings';
      if (!amountError && isCleaning) {
        const taskCost = matchedTask?.cost || 0;
        if (taskCost > amountLine) recommendedPayout = amountLine;
        else if ((amountLine - taskCost) > diffTolerance) recommendedPayout = amountLine - diffThreshold;
        else recommendedPayout = taskCost > 0 ? taskCost : amountLine;
      } else if (!amountError && isPet) {
        recommendedPayout = amountLine * (petPct / 100);
        recommendedExpenseAccount = 'Contract labor:Rental Cleanings:Pet Cleaning';
      }

      let matchStatus = 'Matched';
      const exceptionParts = [];
      if (!numRaw) exceptionParts.push('Missing Num');
      if (amountError) { exceptionParts.push('Invalid amount'); matchStatus = 'Amount Error'; }
      if (isError) exceptionParts.push('Product/Service description is not Cleaning or Pet');
      if (!matchedListing) exceptionParts.push('Item Class does not match a Listing QBO Class');
      if (!matchedReservation) exceptionParts.push('Num does not match any Reservation');
      if (isCleaning && !matchedTask) exceptionParts.push('No Hostaway Cleaning Task found');
      if (isCleaning && matchedTask && matchedTask.cost > amountLine) exceptionParts.push(`Task cost ($${matchedTask.cost}) > QBO fee ($${amountLine})`);
      if (isCleaning && matchedTask && (amountLine - matchedTask.cost) > diffTolerance) exceptionParts.push(`QBO fee >$${diffTolerance} above task cost`);
      if (isCleaning && matchedTask && expectedRate && matchedTask.cost !== expectedRate.cleaning_cost) exceptionParts.push(`Task cost ($${matchedTask.cost}) != expected rate ($${expectedRate.cleaning_cost})`);
      if (!matchedCleaner) exceptionParts.push('Missing cleaner assignment');
      if (isDuplicate) { exceptionParts.push(`Duplicate ${feeType} line`); matchStatus = 'Duplicate'; }

      if (matchStatus !== 'Amount Error' && matchStatus !== 'Duplicate') {
        if (exceptionParts.length === 0) matchStatus = 'Ready for Payout';
        else if (!matchedReservation) matchStatus = 'Missing Reservation';
        else if (isCleaning && !matchedTask) matchStatus = 'Missing Hostaway Task';
        else if (!matchedCleaner) matchStatus = 'Missing Cleaner';
        else matchStatus = 'Needs Review';
      }
      if (isError && matchStatus !== 'Amount Error' && matchStatus !== 'Duplicate') matchStatus = 'Non-Cleaning Line';

      const checkoutDate = extractCheckoutFromDescription(desc) || matchedReservation?.check_out_date || '';

      return {
        import_batch_id: batch.id,
        business_id: businessId,
        qbo_date: qboDate,
        qbo_date_raw: dateRaw,
        item_class: itemClass,
        distribution_account: distributionAccount,
        num: numRaw,
        guest,
        product_service_description: desc,
        product_service_amount_line: amountLine,
        product_service_created_on_date_line: createdOnLine,
        normalized_reservation_key: normKey,
        fee_type: feeType,
        is_cleaning_fee: isCleaning,
        is_pet_fee: isPet,
        is_error_fee_type: isError,
        reservation_id: matchedReservation?.reservation_id || '',
        matched_reservation_id: matchedReservation?.id || '',
        matched_task_id: matchedTask?.id || '',
        matched_listing_id: matchedListing?.id || '',
        match_status: matchStatus,
        exception_reason: exceptionParts.join('; '),
        recommended_cleaner_payout: recommendedPayout,
        recommended_expense_account: recommendedExpenseAccount,
        listing_name: matchedListing?.listing_name || matchedReservation?.listing_name || itemClass || '',
        checkout_date: checkoutDate,
        reservation_created_date: matchedReservation?.reservation_created_date || '',
        cleaner_name: matchedCleaner?.cleaner_name || matchedTask?.assignee_user || '',
        cleaner_id: matchedCleaner?.id || '',
      };
    });

    const validRecords = records.filter(Boolean);
    const toCreate = [], toUpdate = [];
    for (const rec of validRecords) {
      const k = `${rec.num}||${rec.fee_type}`;
      const existing = existingQboByKey[k];
      if (!existing) {
        toCreate.push(rec);
      } else {
        const changed = existing.product_service_amount_line !== rec.product_service_amount_line ||
          existing.match_status !== rec.match_status || existing.checkout_date !== rec.checkout_date;
        if (changed) toUpdate.push({ id: existing.id, data: rec });
      }
    }
    console.log('QBO businessId:', businessId);
    console.log('First QBO record business_id:', toCreate[0]?.business_id);
    console.log('All QBO records missing business_id:', toCreate.filter(r => !r.business_id).length);
    
    const chunkSize = 20;
    for (let i = 0; i < toCreate.length; i += chunkSize) {
      await base44.entities.QboCleanerRevenueLine.bulkCreate(toCreate.slice(i, i + chunkSize));
      if (i + chunkSize < toCreate.length) await new Promise(res => setTimeout(res, 300));
    }
    for (let i = 0; i < toUpdate.length; i += chunkSize) {
      await Promise.all(toUpdate.slice(i, i + chunkSize).map(u => base44.entities.QboCleanerRevenueLine.update(u.id, u.data)));
      if (i + chunkSize < toUpdate.length) await new Promise(res => setTimeout(res, 300));
    }

    await base44.entities.ImportBatch.update(batch.id, { status: 'Completed', row_count: validRecords.length });
    totalImported += validRecords.length;
  }
  return totalImported;
}