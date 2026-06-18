import { CheckCircle2, AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ExceptionsStep({ exceptionItems, resolvedItems, actionLoading, onResolve, onContinue }) {
  const allClear = exceptionItems.length === 0 && resolvedItems.length === 0;

  return (
    <div>
      {allClear ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mb-4 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <span className="text-sm text-emerald-700 font-medium">No exceptions — all tasks are ready for payout.</span>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="flex flex-wrap gap-3 mb-4">
            {exceptionItems.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex gap-2 items-center">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span><strong>{exceptionItems.length}</strong> unresolved exception{exceptionItems.length !== 1 ? 's' : ''} — select an action for each</span>
              </div>
            )}
            {resolvedItems.length > 0 && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 flex gap-2 items-center">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span><strong>{resolvedItems.length}</strong> previously resolved — preserved on re-run</span>
              </div>
            )}
          </div>

          {/* Unresolved exceptions */}
          {exceptionItems.length > 0 && (
            <div className="border rounded-xl overflow-hidden mb-4">
              <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Unresolved Exceptions
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Res Key</th>
                      <th className="px-3 py-2 text-left">Listing</th>
                      <th className="px-3 py-2 text-left">Guest</th>
                      <th className="px-3 py-2 text-left">Checkout</th>
                      <th className="px-3 py-2 text-left">Cleaner</th>
                      <th className="px-3 py-2 text-left">Task $</th>
                      <th className="px-3 py-2 text-left">QBO $</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                      <th className="px-3 py-2 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exceptionItems.map((r) => (
                      <tr key={r.id} className="border-t bg-amber-50/20 hover:bg-amber-50/40">
                        <td className="px-3 py-2">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 whitespace-nowrap">{r.match_status}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.normalized_reservation_key}</td>
                        <td className="px-3 py-2 text-xs">{r.listing_name || '—'}</td>
                        <td className="px-3 py-2 text-xs">{r.guest_name || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.checkout_date || '—'}</td>
                        <td className="px-3 py-2 text-xs">{r.cleaner_name || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.task_cost ? `$${r.task_cost.toFixed(2)}` : '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.qbo_amount ? `$${r.qbo_amount.toFixed(2)}` : '—'}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px] truncate" title={r.exception_reason}>{r.exception_reason || '—'}</td>
                        <td className="px-3 py-2">
                          {actionLoading[r.id] ? (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          ) : (
                            <Select onValueChange={(val) => onResolve(r, val)}>
                              <SelectTrigger className="h-7 text-xs w-40">
                                <SelectValue placeholder="Resolve…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pay_cleaner">✓ Pay Cleaner</SelectItem>
                                <SelectItem value="owner_stay">Owner Stay</SelectItem>
                                <SelectItem value="other_charge_owner">Charge Owner</SelectItem>
                                <SelectItem value="other_do_not_bill">Do Not Bill</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Resolved items */}
          {resolvedItems.length > 0 && (
            <div className="border rounded-xl overflow-hidden mb-4">
              <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Resolved ({resolvedItems.length}) — preserved on re-run
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Res Key</th>
                      <th className="px-3 py-2 text-left">Listing</th>
                      <th className="px-3 py-2 text-left">Guest</th>
                      <th className="px-3 py-2 text-left">Checkout</th>
                      <th className="px-3 py-2 text-left">Resolution</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolvedItems.map((r) => (
                      <tr key={r.id} className="border-t bg-emerald-50/20">
                        <td className="px-3 py-2 font-mono text-xs">{r.normalized_reservation_key}</td>
                        <td className="px-3 py-2 text-xs">{r.listing_name || '—'}</td>
                        <td className="px-3 py-2 text-xs">{r.guest_name || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.checkout_date || '—'}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.exception_reason || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${
                            r.match_status === 'Ready for Payout'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}>{r.match_status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <Button variant="outline" onClick={onContinue}>
        {exceptionItems.length === 0 ? 'Continue' : 'Continue Anyway'} <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );
}