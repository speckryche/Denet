import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared muted empty / loading message for tables and table-sized cards. */
export function TableEmpty({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-4 py-10 text-center text-sm text-muted-foreground', className)}>
      {children}
    </div>
  );
}
