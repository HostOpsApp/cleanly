import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const statusStyles = {
  'Matched': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Ready for Payout': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Approved': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Exported': 'bg-blue-100 text-blue-700 border-blue-200',
  'Completed': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Draft': 'bg-slate-100 text-slate-600 border-slate-200',
  'Pending': 'bg-amber-100 text-amber-700 border-amber-200',
  'In Review': 'bg-amber-100 text-amber-700 border-amber-200',
  'Processing': 'bg-blue-100 text-blue-700 border-blue-200',
  'Ready': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Exception': 'bg-red-100 text-red-700 border-red-200',
  'Error': 'bg-red-100 text-red-700 border-red-200',
  'Missing QBO Invoice': 'bg-orange-100 text-orange-700 border-orange-200',
  'Missing Hostaway Task': 'bg-orange-100 text-orange-700 border-orange-200',
  'Missing Reservation': 'bg-orange-100 text-orange-700 border-orange-200',
  'Missing Cleaner': 'bg-amber-100 text-amber-700 border-amber-200',
  'Missing Task Cost': 'bg-amber-100 text-amber-700 border-amber-200',
  'Cancelled Task': 'bg-slate-100 text-slate-600 border-slate-200',
  'Amount Exception': 'bg-red-100 text-red-700 border-red-200',
  'Cleaning Rate Exception': 'bg-purple-100 text-purple-700 border-purple-200',
  'Needs Review': 'bg-amber-100 text-amber-700 border-amber-200',
};

export default function StatusBadge({ status }) {
  return (
    <Badge variant="outline" className={cn(
      "text-[11px] font-medium px-2 py-0.5",
      statusStyles[status] || 'bg-muted text-muted-foreground border-border'
    )}>
      {status}
    </Badge>
  );
}