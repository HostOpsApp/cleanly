import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { getBusinessId, isSystemAdmin } from "@/lib/roles";

const FEE_COLORS = {
  cleaning_fee: "bg-blue-100 text-blue-800 border-blue-200",
  pet_fee: "bg-amber-100 text-amber-800 border-amber-200",
};

export default function QboImport() {
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const today = format(new Date(), "yyyy-MM-dd");
  const firstOfMonth = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Filters for the imported records table
  const [filterChannel, setFilterChannel] = useState("");
  const [filterFeeType, setFilterFeeType] = useState("");
  const [filterCode, setFilterCode] = useState("");
  const [filterDocNumber, setFilterDocNumber] = useState("");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");

  const { data: records = [], refetch: refetchRecords, isFetching } = useQuery({
    queryKey: ["qbo_invoice_lines", businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.QuickBooksInvoiceLine.list("-invoice_date", 500)
      : base44.entities.QuickBooksInvoiceLine.filter({ business_id: businessId }, "-invoice_date", 500),
  });

  const handleImport = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await base44.functions.invoke("importQuickBooksInvoices", { startDate, endDate, business_id: businessId });
      if (res.data?.success) {
        setResult(res.data.stats);
        refetchRecords();
      } else {
        setError(res.data?.error || "Import failed with an unknown error.");
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Unexpected error during import.");
    } finally {
      setLoading(false);
    }
  };

  // Client-side filtering
  const filtered = records.filter(r => {
    if (filterChannel && !(r.channel || "").toLowerCase().includes(filterChannel.toLowerCase())) return false;
    if (filterFeeType && r.fee_type !== filterFeeType) return false;
    if (filterCode && !(r.confirmation_code || "").toLowerCase().includes(filterCode.toLowerCase())) return false;
    if (filterDocNumber && !(r.doc_number || "").toLowerCase().includes(filterDocNumber.toLowerCase())) return false;
    if (filterStart && r.invoice_date && r.invoice_date < filterStart) return false;
    if (filterEnd && r.invoice_date && r.invoice_date > filterEnd) return false;
    return true;
  });

  const statItems = result ? [
    { label: "Invoices Received", value: result.invoices_received },
    { label: "Lines Reviewed", value: result.invoice_lines_reviewed },
    { label: "Cleaning Fee Lines", value: result.cleaning_fee_lines_found },
    { label: "Pet Fee Lines", value: result.pet_fee_lines_found },
    { label: "Records Created", value: result.records_created, color: "text-green-600" },
    { label: "Records Updated", value: result.records_updated, color: "text-blue-600" },
    { label: "Records Skipped", value: result.records_skipped, color: "text-muted-foreground" },
    { label: "Errors", value: result.errors, color: result.errors > 0 ? "text-red-600" : "text-muted-foreground" },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="QuickBooks Import"
        description="Import Cleaning Fee and Pet Fee invoice lines from QuickBooks Online."
      />

      {/* Import Controls */}
      <Card>
        <CardHeader><CardTitle className="text-base">Import Invoices</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" />
            </div>
            <Button onClick={handleImport} disabled={loading || !startDate || !endDate}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing…</> : <><Download className="w-4 h-4 mr-2" />Import Invoices</>}
            </Button>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Stats */}
          {result && (
            <div className="mt-5">
              <p className="text-sm font-medium text-green-700 mb-3">Import complete.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {statItems.map(s => (
                  <div key={s.label} className="bg-muted/50 rounded-lg p-3 border">
                    <div className={`text-2xl font-bold font-mono ${s.color || ""}`}>{s.value ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Imported Records ({filtered.length})</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => refetchRecords()} disabled={isFetching}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date From</Label>
              <Input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)} className="w-36 h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date To</Label>
              <Input type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} className="w-36 h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Channel</Label>
              <Input placeholder="e.g. airbnb" value={filterChannel} onChange={e => setFilterChannel(e.target.value)} className="w-32 h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fee Type</Label>
              <select
                value={filterFeeType}
                onChange={e => setFilterFeeType(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">All</option>
                <option value="cleaning_fee">Cleaning Fee</option>
                <option value="pet_fee">Pet Fee</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Confirmation Code</Label>
              <Input placeholder="Search…" value={filterCode} onChange={e => setFilterCode(e.target.value)} className="w-40 h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Doc Number</Label>
              <Input placeholder="Search…" value={filterDocNumber} onChange={e => setFilterDocNumber(e.target.value)} className="w-28 h-8 text-sm" />
            </div>
            {(filterChannel || filterFeeType || filterCode || filterDocNumber || filterStart || filterEnd) && (
              <div className="flex items-end">
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setFilterChannel(""); setFilterFeeType(""); setFilterCode(""); setFilterDocNumber(""); setFilterStart(""); setFilterEnd(""); }}>
                  Clear Filters
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice Date</TableHead>
                  <TableHead>Doc #</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Guest Name</TableHead>
                  <TableHead>Confirmation Code</TableHead>
                  <TableHead>Fee Type</TableHead>
                  <TableHead>Item Ref</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      {records.length === 0 ? "No records imported yet." : "No records match the current filters."}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {r.invoice_date ? format(new Date(r.invoice_date), "MM/dd/yyyy") : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.doc_number || "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{r.channel || "—"}</TableCell>
                    <TableCell className="text-sm">{r.guest_name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.confirmation_code || "—"}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs border ${FEE_COLORS[r.fee_type] || ""}`}>
                        {r.fee_type === "cleaning_fee" ? "Cleaning Fee" : r.fee_type === "pet_fee" ? "Pet Fee" : r.fee_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.item_ref || "—"}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={r.description}>{r.description || "—"}</TableCell>
                    <TableCell className="font-mono text-sm text-right font-semibold">
                      ${(r.line_amount || 0).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}