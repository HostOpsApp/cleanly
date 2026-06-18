import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Printer, Loader2, PrinterCheck } from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import BillReceiptPrint from '@/components/export/BillReceiptPrint';
import SendReceiptButton from '@/components/export/SendReceiptButton';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';

export default function Export() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const [selectedRunId, setSelectedRunId] = useState('');
  const [exporting, setExporting] = useState(false);
  const printRefs = useRef({});

  const { data: runs = [] } = useQuery({
    queryKey: ['payoutRuns', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.PayoutRun.list('-created_date', 50)
      : base44.entities.PayoutRun.filter({ business_id: businessId }, '-created_date', 50),
    initialData: [],
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ['payoutItems', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.PayoutItem.list('-created_date', 1000)
      : base44.entities.PayoutItem.filter({ business_id: businessId }, '-created_date', 1000),
    initialData: [],
  });

  const { data: cleaners = [] } = useQuery({
    queryKey: ['cleaners', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.Cleaner.list('cleaner_name', 100)
      : base44.entities.Cleaner.filter({ business_id: businessId }, 'cleaner_name', 100),
    initialData: [],
  });

  const { data: settings = [] } = useQuery({
    queryKey: ['appSettings', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.AppSetting.list()
      : base44.entities.AppSetting.filter({ business_id: businessId }),
    initialData: [],
  });

  const getSetting = (key, fallback = '') => (settings.find(s => s.setting_key === key) || {}).setting_value || fallback;
  const companyInfo = {
    name: getSetting('company_name'),
    address_line1: getSetting('company_address_line1'),
    address_line2: getSetting('company_address_line2'),
    website: getSetting('company_website'),
    logo_url: getSetting('company_logo_url'),
    header_color: getSetting('receipt_header_color', '#1a1a2e'),
    accent_color: getSetting('receipt_accent_color', '#4f6ef7'),
  };

  const printStyle = `<style>body{margin:0;padding:0;} @media print { body{-webkit-print-color-adjust:exact;} }</style>`;

  const handlePrint = useCallback((billNum) => {
    const el = printRefs.current[billNum];
    if (!el) return;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>${billNum}</title>${printStyle}</head><body>${el.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }, []);

  const handlePrintAll = useCallback((groupedEntries) => {
    const allHtml = groupedEntries.map(([billNum]) => {
      const el = printRefs.current[billNum];
      return el ? `<div style="page-break-after:always">${el.innerHTML}</div>` : '';
    }).join('');
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>All Bills</title>${printStyle}</head><body>${allHtml}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }, []);

  const items = selectedRunId ? allItems.filter(i => i.payout_run_id === selectedRunId) : [];
  const selectedRun = runs.find(r => r.id === selectedRunId);

  const cleanerMap = {};
  cleaners.forEach(c => { cleanerMap[c.id] = c; });

  // Group items by cleaner + bill number, sorted by cleaner name asc
  const grouped = {};
  items.forEach(item => {
    const key = item.bill_number || item.cleaner_name;
    if (!grouped[key]) grouped[key] = { cleaner_name: item.cleaner_name, bill_number: item.bill_number, items: [] };
    grouped[key].items.push(item);
  });
  // Sort each group's items by checkout_date asc
  Object.values(grouped).forEach(g => {
    g.items.sort((a, b) => (a.checkout_date || '').localeCompare(b.checkout_date || ''));
  });
  const groupedEntries = Object.entries(grouped).sort(([, a], [, b]) =>
    (a.cleaner_name || '').localeCompare(b.cleaner_name || '')
  );



  const exportCSV = async () => {
  setExporting(true);

  try {
    const formatCsvDate = (dateValue) => {
      if (!dateValue) return '';
      const d = new Date(`${dateValue}T12:00:00`);
      if (Number.isNaN(d.getTime())) return '';
      return format(d, 'M/d/yy');
    };

    // Bill Date and Due Date should be the last day of the payout period
    const billDate = formatCsvDate(selectedRun?.end_date) || format(new Date(), 'M/d/yy');

    const headers = [
      'Post?',
      'Invoice/Bill Date',
      'Due Date',
      'Invoice / Bill Number',
      'Transaction Type',
      'Customer',
      'Vendor',
      'Currency Code',
      'Product/Services',
      'Description',
      'Qty',
      'Discount %',
      'Unit Price',
      'Category',
      'Location',
      'Class',
      'Tax',
    ];

    const rows = [headers.map(escapeCSV).join(',')];

    items.forEach(item => {
      const cleaner = cleanerMap[item.cleaner_id];

      const vendor = cleaner?.qbo_vendor_name || item.cleaner_name || '';
      const description = item.qbo_description || '';
      const billNumber =
        item.bill_number ||
        `${item.cleaner_name || 'CLEANER'}-${selectedRun?.pay_period_month || ''}-${selectedRun?.pay_period_number || ''}`;

      const amount = Number(item.amount || 0).toFixed(2);
      const category = item.expense_account || 'Contract labor:Rental Cleanings';
      const qboClass = item.qbo_class || item.listing_name || '';

      const row = [
        'No',              // Post?
        billDate,          // Invoice/Bill Date
        billDate,          // Due Date
        billNumber,        // Invoice / Bill Number
        'Bill',            // Transaction Type
        '',                // Customer
        vendor,            // Vendor
        'usd',             // Currency Code
        '',                // Product/Services
        description,       // Description
        '1.00',            // Qty
        '',                // Discount %
        amount,            // Unit Price
        category,          // Category
        'pm',              // Location
        qboClass,          // Class
        'no',              // Tax
      ];

      rows.push(row.map(escapeCSV).join(','));
    });

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `cleaner-bills-${selectedRun?.pay_period_month || 'period'}-${selectedRun?.pay_period_number || ''}.csv`;
    a.click();

    URL.revokeObjectURL(url);

    // Mark items as exported
    for (const item of items) {
      await base44.entities.PayoutItem.update(item.id, {
        status: 'Exported',
      });
    }

    if (selectedRunId) {
      await base44.entities.PayoutRun.update(selectedRunId, {
        status: 'Exported',
        exported_at: new Date().toISOString(),
      });
    }

    toast.success(`Exported ${items.length} payout items to CSV`);
    qc.invalidateQueries();
  } catch (error) {
    console.error('CSV export failed:', error);
    toast.error('Failed to export cleaner bills CSV');
  } finally {
    setExporting(false);
  }
};

  return (
    <div>
      <PageHeader
        title="Export Cleaner Bills"
        description="Generate QuickBooks-ready CSV for cleaner bill import"
        actions={
          <div className="flex items-center gap-3">
            <Select value={selectedRunId} onValueChange={setSelectedRunId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select payout run" /></SelectTrigger>
              <SelectContent>
                {runs.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.run_name} ({r.pay_period_month}-{r.pay_period_number})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => handlePrintAll(groupedEntries)} disabled={!selectedRunId || items.length === 0}>
              <PrinterCheck className="w-4 h-4 mr-2" />Print All Bills
            </Button>
            <Button onClick={exportCSV} disabled={!selectedRunId || items.length === 0 || exporting}>
              {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Export CSV
            </Button>
          </div>
        }
      />

      {selectedRun && (
        <div className="flex gap-4 mb-6 flex-wrap">
          <div className="bg-card rounded-lg border px-4 py-3">
            <p className="text-xs text-muted-foreground">Period</p>
            <p className="font-mono font-semibold">{selectedRun.pay_period_month}-{selectedRun.pay_period_number}</p>
          </div>
          <div className="bg-card rounded-lg border px-4 py-3">
            <p className="text-xs text-muted-foreground">Total Amount</p>
            <p className="font-mono font-semibold">${(selectedRun.total_amount || 0).toFixed(2)}</p>
          </div>
          <div className="bg-card rounded-lg border px-4 py-3">
            <p className="text-xs text-muted-foreground">Line Items</p>
            <p className="font-semibold">{items.length}</p>
          </div>
          <div className="bg-card rounded-lg border px-4 py-3">
            <p className="text-xs text-muted-foreground">Cleaners</p>
            <p className="font-semibold">{Object.keys(grouped).length}</p>
          </div>
        </div>
      )}

      {/* Grouped by cleaner — sorted alphabetically */}
      {groupedEntries.map(([billNum, group]) => {
        const cleaner = cleanerMap[group.items[0]?.cleaner_id] || { cleaner_name: group.cleaner_name };
        const groupTotal = group.items.reduce((s, i) => s + (i.amount || 0), 0);
        return (
          <div key={billNum} className="bg-card rounded-xl border mb-4 overflow-hidden">
            {/* Hidden print target */}
            <div style={{ display: 'none' }}>
              <BillReceiptPrint
                ref={el => { printRefs.current[billNum] = el; }}
                items={group.items}
                cleaner={cleaner}
                run={selectedRun || {}}
                companyInfo={companyInfo}
              />
            </div>

            <div className="px-5 py-3 bg-muted/50 border-b flex items-center justify-between">
              <div>
                <span className="font-semibold">{group.cleaner_name}</span>
                <span className="ml-3 font-mono text-xs text-muted-foreground">{group.bill_number}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold">${groupTotal.toFixed(2)}</span>
                <SendReceiptButton
                  cleaner={cleaner}
                  group={group}
                  run={selectedRun}
                  companyInfo={companyInfo}
                  onSent={() => qc.invalidateQueries({ queryKey: ['payoutRuns'] })}
                />
                <Button size="sm" variant="outline" onClick={() => handlePrint(billNum)}>
                  <Printer className="w-3.5 h-3.5 mr-1.5" />Print Bill
                </Button>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Completed Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Listing / Class</TableHead>
                  <TableHead>Res Key</TableHead>
                  <TableHead>Fee Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.checkout_date ? format(new Date(item.checkout_date), 'MM/dd/yyyy') : '—'}</TableCell>
                    <TableCell className="text-sm">{item.description}</TableCell>
                    <TableCell className="text-sm">{item.qbo_class || item.listing_name}</TableCell>
                    <TableCell className="font-mono text-xs">{item.normalized_reservation_key}</TableCell>
                    <TableCell className="text-xs">{item.fee_type}</TableCell>
                    <TableCell className="font-mono font-semibold">${(item.amount || 0).toFixed(2)}</TableCell>
                    <TableCell><StatusBadge status={item.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}

      {selectedRunId && items.length === 0 && (
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">
          No payout items in this run. Generate payouts first.
        </div>
      )}


    </div>
  );
}

function escapeCSV(val) {
  if (!val) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}