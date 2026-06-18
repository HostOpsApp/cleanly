import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

/**
 * Send Payment Receipt email to a cleaner.
 * Uses Base44's built-in SendEmail (sends to any external email address).
 * Includes full receipt details in the email body (no PDF attachment needed).
 * Tracks email_sent / email_sent_at / email_sent_to / email_error on the PayoutRun.
 */
export default function SendReceiptButton({ cleaner, group, run, companyInfo, onSent }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleOpen = () => {
    setEmail(cleaner?.email || '');
    setSent(false);
    setOpen(true);
  };

  const cleaningPeriod = run?.start_date && run?.end_date
    ? `${format(new Date(`${run.start_date}T12:00:00`), 'MMMM d')} – ${format(new Date(`${run.end_date}T12:00:00`), 'd, yyyy')}`
    : `${run?.pay_period_month || ''}–${run?.pay_period_number || ''}`;

  const companyName = companyInfo?.name || 'CleanPay';
  const billNumber = group?.bill_number || group?.items?.[0]?.bill_number || '';
  const sortedItems = [...(group?.items || [])].sort((a, b) => (a.checkout_date || '').localeCompare(b.checkout_date || ''));
  const total = sortedItems.reduce((s, i) => s + (i.amount || 0), 0);

  const buildEmailBody = () => {
    const lineRows = sortedItems.map(item =>
      `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px">${item.checkout_date ? format(new Date(`${item.checkout_date}T12:00:00`), 'MM/dd/yyyy') : '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px">${item.description || '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px">${item.qbo_class || item.listing_name || '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px">${item.fee_type || '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;font-weight:600">$${(item.amount || 0).toFixed(2)}</td>
      </tr>`
    ).join('');

    return `
<div style="font-family:Arial,sans-serif;font-size:13px;color:#1a1a2e;max-width:680px;margin:0 auto">
  <div style="background:#1a1a2e;padding:20px 28px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;color:#fff;font-size:18px">${companyName}</h2>
    <p style="margin:4px 0 0;color:#94a3b8;font-size:12px">Payment Receipt Confirmation</p>
  </div>

  <div style="border:1px solid #e2e8f0;border-top:none;padding:24px 28px;border-radius:0 0 8px 8px">
    <p style="font-size:14px;margin-top:0">Hi <strong>${cleaner?.cleaner_name || ''}</strong>,</p>
    <p style="color:#475569">Attached or included below is confirmation of your cleaner payout for the period <strong>${cleaningPeriod}</strong>.</p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 18px;margin:20px 0;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:700;color:#15803d;font-size:13px">✓ Payment Confirmed</div>
        <div style="color:#166534;font-size:11px;margin-top:2px">Receipt #${billNumber}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:#94a3b8">Total Paid</div>
        <div style="font-size:22px;font-weight:800;color:#15803d;font-family:monospace">$${total.toFixed(2)}</div>
      </div>
    </div>

    <div style="display:flex;gap:20px;margin-bottom:20px">
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:5px">Payment From</div>
        <div style="font-weight:700;font-size:13px">${companyName}</div>
        ${companyInfo?.address_line1 ? `<div style="color:#64748b;font-size:11px">${companyInfo.address_line1}</div>` : ''}
        ${companyInfo?.address_line2 ? `<div style="color:#64748b;font-size:11px">${companyInfo.address_line2}</div>` : ''}
      </div>
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:5px">Payment To</div>
        <div style="font-weight:700;font-size:13px">${cleaner?.cleaner_name || ''}</div>
        ${cleaner?.mailing_address ? `<div style="color:#64748b;font-size:11px">${cleaner.mailing_address}</div>` : ''}
        ${cleaner?.email ? `<div style="color:#64748b;font-size:11px">${cleaner.email}</div>` : ''}
      </div>
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:5px">Payment Details</div>
        <table style="font-size:11px;width:100%">
          <tr><td style="color:#94a3b8;padding:1px 0">Period</td><td style="font-weight:600;text-align:right">${cleaningPeriod}</td></tr>
          <tr><td style="color:#94a3b8;padding:1px 0">Receipt #</td><td style="font-weight:600;text-align:right;font-family:monospace">${billNumber}</td></tr>
          <tr><td style="color:#94a3b8;padding:1px 0">Date</td><td style="font-weight:600;text-align:right">${format(new Date(), 'MM/dd/yyyy')}</td></tr>
        </table>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#1a1a2e">
          <th style="padding:8px 10px;text-align:left;color:#e2e8f0;font-size:10px;font-weight:700;text-transform:uppercase">Checkout Date</th>
          <th style="padding:8px 10px;text-align:left;color:#e2e8f0;font-size:10px;font-weight:700;text-transform:uppercase">Description</th>
          <th style="padding:8px 10px;text-align:left;color:#e2e8f0;font-size:10px;font-weight:700;text-transform:uppercase">Property</th>
          <th style="padding:8px 10px;text-align:left;color:#e2e8f0;font-size:10px;font-weight:700;text-transform:uppercase">Fee Type</th>
          <th style="padding:8px 10px;text-align:right;color:#e2e8f0;font-size:10px;font-weight:700;text-transform:uppercase">Amount</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div style="border-top:2px solid #1a1a2e;margin-top:0">
      <div style="display:flex;justify-content:flex-end;align-items:center;background:#1a1a2e;padding:10px 10px">
        <span style="font-weight:700;font-size:12px;color:#e2e8f0;margin-right:32px;text-transform:uppercase;letter-spacing:0.05em">Total Paid</span>
        <span style="font-family:monospace;font-weight:800;font-size:16px;color:#fff;min-width:80px;text-align:right">$${total.toFixed(2)}</span>
      </div>
    </div>

    <p style="color:#94a3b8;font-size:11px;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:14px">
      This is an official payment notification from ${companyName}. Please keep this for your records.
    </p>
  </div>
</div>`;
  };

  const handleSend = async () => {
    if (!email.trim()) { toast.error('Please enter a recipient email address.'); return; }
    setSending(true);
    try {
      await base44.integrations.Core.SendEmail({
        to: email.trim(),
        subject: `Payment Receipt - ${cleaningPeriod}`,
        body: buildEmailBody(),
        from_name: companyName,
      });

      // Track on PayoutRun record
      if (run?.id) {
        const existingSentTo = run.email_sent_to ? run.email_sent_to.split(',').map(e => e.trim()) : [];
        if (!existingSentTo.includes(email.trim())) existingSentTo.push(email.trim());
        await base44.entities.PayoutRun.update(run.id, {
          email_sent: true,
          email_sent_at: new Date().toISOString(),
          email_sent_to: existingSentTo.join(', '),
          email_error: '',
        });
      }

      setSent(true);
      toast.success(`Receipt sent to ${email}`);
      onSent?.();
    } catch (err) {
      // Track error on run
      if (run?.id) {
        await base44.entities.PayoutRun.update(run.id, { email_error: err.message }).catch(() => {});
      }
      toast.error(`Failed to send: ${err.message}`);
    }
    setSending(false);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={handleOpen}>
        <Mail className="w-3.5 h-3.5 mr-1.5" />
        {run?.email_sent ? 'Re-send Receipt' : 'Send Receipt'}
      </Button>

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send Payment Receipt</DialogTitle>
          </DialogHeader>

          {sent ? (
            <div className="py-4 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              <p className="font-semibold text-sm">Receipt sent successfully!</p>
              <p className="text-xs text-muted-foreground">Sent to <strong>{email}</strong></p>
              <Button className="mt-2" onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <>
              <div className="space-y-3 py-2">
                <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                  <div><span className="text-muted-foreground">Cleaner:</span> <strong>{cleaner?.cleaner_name}</strong></div>
                  <div><span className="text-muted-foreground">Period:</span> <strong>{cleaningPeriod}</strong></div>
                  <div><span className="text-muted-foreground">Receipt #:</span> <strong className="font-mono">{billNumber}</strong></div>
                  <div><span className="text-muted-foreground">Total:</span> <strong className="font-mono">${total.toFixed(2)}</strong></div>
                </div>

                {!cleaner?.email && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    No email on file for this cleaner. Enter one below.
                  </div>
                )}

                <div>
                  <Label className="text-xs">Recipient Email *</Label>
                  <Input
                    type="email"
                    className="mt-1"
                    placeholder="cleaner@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleSend} disabled={!email.trim() || sending}>
                  {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : <><Mail className="w-4 h-4 mr-2" />Send Email</>}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}