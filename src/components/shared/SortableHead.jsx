import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';

export function SortIcon({ field, sort }) {
  if (sort.field !== field) return <ChevronsUpDown className="w-3 h-3 ml-1 opacity-40 inline" />;
  return sort.dir === 'asc'
    ? <ChevronUp className="w-3 h-3 ml-1 inline" />
    : <ChevronDown className="w-3 h-3 ml-1 inline" />;
}

export function SortableHead({ label, field, sort, onSort, className }) {
  return (
    <TableHead
      className={`cursor-pointer select-none hover:text-foreground whitespace-nowrap ${className || ''}`}
      onClick={() => onSort(field)}
    >
      {label}<SortIcon field={field} sort={sort} />
    </TableHead>
  );
}

export function useTableSort(defaultField = 'created_date', defaultDir = 'desc') {
  const [sort, setSort] = useState({ field: defaultField, dir: defaultDir });
  const toggleSort = (field) => setSort(prev =>
    prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'asc' }
  );
  return { sort, toggleSort };
}