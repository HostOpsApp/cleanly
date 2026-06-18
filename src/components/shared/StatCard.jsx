import { cn } from '@/lib/utils';

export default function StatCard({ label, value, icon: Icon, variant = 'default', subtitle }) {
  const variants = {
    default: 'border-border',
    primary: 'border-primary/20 bg-primary/5',
    success: 'border-success/20 bg-success/5',
    warning: 'border-accent/20 bg-accent/5',
    danger: 'border-destructive/20 bg-destructive/5',
  };

  const iconVariants = {
    default: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-accent/10 text-accent',
    danger: 'bg-destructive/10 text-destructive',
  };

  return (
    <div className={cn(
      "rounded-xl border bg-card p-5 transition-all duration-200 hover:shadow-md",
      variants[variant]
    )}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={cn("p-2.5 rounded-lg", iconVariants[variant])}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
    </div>
  );
}