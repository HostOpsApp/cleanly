import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2 } from 'lucide-react';
import PayPeriodSelector from '@/components/shared/PayPeriodSelector';

export default function CreatePayoutRunDialog({ open, onOpenChange, month, number, onMonthChange, onNumberChange, onConfirm }) {
  const [runName, setRunName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm({ runName });
    setLoading(false);
    setRunName('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Payout Run</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Pay Period</Label>
            <div className="mt-1">
              <PayPeriodSelector month={month} number={number} onMonthChange={onMonthChange} onNumberChange={onNumberChange} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Run Name (optional)</Label>
            <Input
              value={runName}
              onChange={e => setRunName(e.target.value)}
              placeholder={`Payout Run ${month}-${number}`}
              className="mt-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This will automatically pull all "Ready for Payout" matched items for the selected period. You can add manual lines afterward.
          </p>
          <Button onClick={handleConfirm} className="w-full" disabled={loading}>
            {loading
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</>
              : <><CheckCircle2 className="w-4 h-4 mr-2" />Create Run</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}