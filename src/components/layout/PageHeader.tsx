import { ReactNode } from 'react';
import UserMenu from './UserMenu';
import { ThemeToggle } from './ThemeToggle';

interface PageHeaderProps {
  title: string;
  // Optional kicker line under the title.
  subtitle?: ReactNode;
  // Page-specific controls (filters, exports) rendered before the theme
  // toggle and user menu. `children` is accepted as an alias.
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageHeader({ title, subtitle, actions, children }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-elevated">
      <div className="flex min-h-16 items-center justify-between gap-4 px-6 py-2 lg:px-7">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold leading-tight tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs font-medium text-dim">{subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {actions}
          {children}
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
