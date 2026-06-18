import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Generic CSV upload + template download button.
 * Props:
 *   templateHeaders: string[]  — column names for the template
 *   templateRows: string[][]   — optional sample rows
 *   templateFilename: string   — e.g. "cleaners_template.csv"
 *   onParsed: (rows: object[]) => Promise<void>  — called with parsed rows
 *   label: string              — button label
 */
export default function CsvUploadButton({ templateHeaders, templateRows = [], templateFilename, onParsed, label = 'Upload CSV' }) {
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null); // { headers, rows }
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { success, failed }

  const downloadTemplate = () => {
    const lines = [templateHeaders.join(',')];
    templateRows.forEach(r => lines.push(r.map(v => `"${v}"`).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = templateFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { toast.error('CSV must have a header row and at least one data row'); return; }
      const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
      const rows = lines.slice(1).map(line => {
        const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || [];
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (vals[i] || '').replace(/^"|"$/g, '').trim(); });
        return obj;
      }).filter(r => Object.values(r).some(v => v));
      setPreview({ headers, rows });
      setResult(null);
      setOpen(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      await onParsed(preview.rows);
      setResult({ success: preview.rows.length });
      toast.success(`Imported ${preview.rows.length} records`);
    } catch (err) {
      toast.error('Import failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={downloadTemplate}>
          <Download className="w-3.5 h-3.5 mr-1" />Template
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="w-3.5 h-3.5 mr-1" />{label}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setPreview(null); setResult(null); } }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Preview Import — {preview?.rows.length} rows</DialogTitle>
          </DialogHeader>

          {result ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="text-sm font-medium">Successfully imported {result.success} records</p>
            </div>
          ) : (
            <div className="overflow-auto flex-1 border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>{preview?.headers.map(h => <th key={h} className="px-2 py-1.5 text-left font-medium border-b">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview?.rows.slice(0, 20).map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      {preview.headers.map(h => <td key={h} className="px-2 py-1 truncate max-w-[160px]">{row[h] || ''}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview?.rows.length > 20 && <p className="text-xs text-muted-foreground p-2">…and {preview.rows.length - 20} more rows</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setPreview(null); setResult(null); }}>
              {result ? 'Close' : 'Cancel'}
            </Button>
            {!result && (
              <Button onClick={handleImport} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
                Import {preview?.rows.length} Records
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}