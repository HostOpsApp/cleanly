import { format, startOfMonth, endOfMonth } from 'date-fns';

export function getCurrentPayPeriod() {
  const now = new Date();
  const month = format(now, 'yyyyMM');
  const day = now.getDate();
  const number = day <= 14 ? '001' : '002';
  return { month, number };
}

export function getPayPeriodLabel(month, number) {
  if (!month) return 'No period selected';
  const year = month.substring(0, 4);
  const mo = month.substring(4, 6);
  const periodLabel = number === '001' ? '1st - 14th' : '15th - End';
  return `${year}-${mo} (${periodLabel})`;
}

export function getPayPeriodDates(month, number) {
  if (!month) return { start: null, end: null };
  const year = parseInt(month.substring(0, 4));
  const mo = parseInt(month.substring(4, 6)) - 1;
  const date = new Date(year, mo, 1);
  
  if (number === '001') {
    return {
      start: format(startOfMonth(date), 'yyyy-MM-dd'),
      end: format(new Date(year, mo, 14), 'yyyy-MM-dd'),
    };
  } else {
    return {
      start: format(new Date(year, mo, 15), 'yyyy-MM-dd'),
      end: format(endOfMonth(date), 'yyyy-MM-dd'),
    };
  }
}

export function generateBillNumber(cleanerCode, month, periodNumber) {
  return `${cleanerCode}${month}-${periodNumber}`;
}