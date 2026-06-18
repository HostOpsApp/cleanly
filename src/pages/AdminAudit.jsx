import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Trash2, RotateCcw, Eye, Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';

const ENTITY_MAP = {
  CleaningTask: base44.entities.CleaningTask,
  Reservation: base44.entities.Reservation,
  QboCleanerRevenueLine: base44.entities.QboCleanerRevenueLine,
  PayoutItem: base44.entities.PayoutItem,
};

const ENTITY_LABELS = {
  CleaningTask: 'Cleaning Task',
  Reservation: 'Reservation',
  QboCleanerRevenueLine: 'QBO Revenue Line',
  PayoutItem: 'Payout Item',
};

const actionColor = (a) => a === 'deleted'
  ? 'bg-red-100 text-red-700 border-red-200'
  : 'bg-amber-100 text-amber-700 border-amber-200';

export default function AdminAudit() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const [filterEntity, setFilterEntity] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const [viewLog, setViewLog] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [noteDialog, setNoteDialog] = useState(null); // { log, note }

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['auditLogs', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.AuditLog.list('-created_date', 500)
      : base44.entities.AuditLog.filter({ business_id: businessId }, '-created_date', 500),
    initialData: [],
  });

  const filtered = logs.filter(l => {
    if (filterEntity !== 'all' && l.entity_type !== filterEntity) return false;
    if (filterAction !== 'all' && l.action !== filterAction) return false;
    return true;
  });

  const handleRestore = async (log) => {
    if (!log.snapshot) { toast.error('No snapshot available to restore'); return; }
    if (!confirm(`Restore this ${ENTITY_LABELS[log.entity_type]} record?`)) return;
    setRestoring(log.id);
    const data = JSON.parse(log.snapshot);
    const { id, created_date, updated_date, ...fields } = data;
    await ENTITY_MAP[log.entity_type].create({ ...fields, ...(businessId ? { business_id: fields.business_id || businessId } : {}) });
    await base44.entities.AuditLog.update(log.id, { notes: (log.notes || '') + ' [RESTORED]' });
    qc.invalidateQueries({ queryKey: ['auditLogs'] });
    toast.success('Record restored successfully');
    setRestoring(null);
  };

  const handleDeleteLog = async (logId) => {
    if (!confirm('Permanently delete this audit log entry?')) return;
    setDeleting(logId);
    await base44.entities.AuditLog.delete(logId);
    qc.invalidateQueries({ queryKey: ['auditLogs'] });
    setDeleting(null);
  };

  const handleSaveNote = async () => {
    await base44.entities.AuditLog.update(noteDialog.log.id, { notes: noteDialog.note });
    qc.invalidateQueries({ queryKey: ['auditLogs'] });
    toast.success('Note saved');
    setNoteDialog(null);
  };

  return (
    <div>
      <PageHeader
        title="Admin Audit Log"
        description="Track deleted and edited records across all entity types. Restore from snapshot when needed."
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Select value={filterEntity} onValueChange={setFilterEntity}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Entity Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entity Types</SelectItem>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All Actions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
            <SelectItem value="edited">Edited</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground self-center">{filtered.length} entries</span>
      </div>

      <div className="bg-card rounded-xl border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Entity Type</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Record ID</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Changed Fields</TableHead>
              <TableHead>Performed By</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No audit log entries yet. Deletions and edits will appear here once you log them.</TableCell></TableRow>
            ) : filtered.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(log.created_date).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{ENTITY_LABELS[log.entity_type] || log.entity_type}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs ${actionColor(log.action)}`}>{log.action}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{log.record_id}</TableCell>
                <TableCell className="text-sm max-w-[180px] truncate" title={log.record_summary}>{log.record_summary || '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate" title={log.changed_fields}>
                  {log.changed_fields ? JSON.parse(log.changed_fields || '[]').join(', ') : '—'}
                </TableCell>
                <TableCell className="text-sm">{log.performed_by || '—'}</TableCell>
                <TableCell className="text-xs max-w-[140px] truncate text-muted-foreground" title={log.notes}>{log.notes || '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {log.snapshot && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => setViewLog(log)} title="View snapshot">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {log.action === 'deleted' && log.snapshot && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-emerald-600" onClick={() => handleRestore(log)} disabled={restoring === log.id} title="Restore record">
                        {restoring === log.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-muted-foreground" onClick={() => setNoteDialog({ log, note: log.notes || '' })} title="Add note">
                      <span className="text-[10px] font-bold">N</span>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteLog(log.id)} disabled={deleting === log.id} title="Delete log entry">
                      {deleting === log.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Snapshot viewer */}
      <Dialog open={!!viewLog} onOpenChange={(o) => { if (!o) setViewLog(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Snapshot — {viewLog && ENTITY_LABELS[viewLog.entity_type]}</DialogTitle>
          </DialogHeader>
          <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto whitespace-pre-wrap">
            {viewLog?.snapshot ? JSON.stringify(JSON.parse(viewLog.snapshot), null, 2) : ''}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewLog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Note editor */}
      <Dialog open={!!noteDialog} onOpenChange={(o) => { if (!o) setNoteDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add / Edit Note</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs mb-1">Note</Label>
            <Textarea
              value={noteDialog?.note || ''}
              onChange={e => setNoteDialog(p => ({ ...p, note: e.target.value }))}
              rows={4}
              placeholder="Add context or resolution notes..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialog(null)}>Cancel</Button>
            <Button onClick={handleSaveNote}>Save Note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}