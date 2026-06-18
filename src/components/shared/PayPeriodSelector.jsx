import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, subMonths, addMonths } from 'date-fns';

export default function PayPeriodSelector({ month, number, onMonthChange, onNumberChange }) {
  const months = [];
  const now = new Date();
  for (let i = -6; i <= 2; i++) {
    const d = i < 0 ? subMonths(now, Math.abs(i)) : addMonths(now, i);
    months.push(format(d, 'yyyyMM'));
  }

  const formatMonth = (m) => {
    if (!m) return '';
    return `${m.substring(0, 4)}-${m.substring(4, 6)}`;
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={month} onValueChange={onMonthChange}>
        <SelectTrigger className="w-36 h-9 text-sm">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={number} onValueChange={onNumberChange}>
        <SelectTrigger className="w-28 h-9 text-sm">
          <SelectValue placeholder="Period" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="001">Period 001</SelectItem>
          <SelectItem value="002">Period 002</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}