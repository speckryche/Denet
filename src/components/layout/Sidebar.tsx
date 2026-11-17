import { NavLink } from 'react-router-dom';
import {
  Home,
  BarChart3,
  Calculator,
  Banknote,
  TrendingUp,
  Settings,
  ChevronLeft,
  ChevronRight,
  Server,
  Upload,
  Wallet,
  Clock,
  BookOpen, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/contexts/SidebarContext';
import { usePendingCount } from '@/components/pending/pending-count';
import { useAuth } from '@/contexts/AuthContext';

interface NavItem {
  name: string;
  path: string;
  icon: React.ReactNode;
  title: string;
  // When true, the actionable pending-resolution count renders as a badge.
  showPendingBadge?: boolean;
  // When true, the item is hidden from non-admins (the page blocks them too).
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const iconClass = "w-[18px] h-[18px] shrink-0";

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { name: 'Dashboard', path: '/', icon: <Home className={iconClass} />, title: 'Dashboard' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { name: 'CSV Uploads', path: '/csv-uploads', icon: <Upload className={iconClass} />, title: 'CSV Uploads' },
      {
        name: 'Pending Resolution',
        path: '/pending-resolution',
        icon: <Clock className={iconClass} />,
        title: 'Pending Resolution',
        showPendingBadge: true,
      },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { name: 'Reports', path: '/reports', icon: <BarChart3 className={iconClass} />, title: 'Reports' },
      { name: 'Commissions', path: '/commissions', icon: <Calculator className={iconClass} />, title: 'Commission Calculator' },
      { name: 'Bitstop Commissions', path: '/bitstop-commissions', icon: <TrendingUp className={iconClass} />, title: 'Bitstop Commissions' },
    ],
  },
  {
    label: 'Treasury',
    items: [
      { name: 'Cash Management', path: '/cash-management', icon: <Banknote className={iconClass} />, title: 'Cash Management' },
      { name: 'Liquidity', path: '/liquidity', icon: <Wallet className={iconClass} />, title: 'Liquidity' },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { name: 'BTM Machine Details', path: '/btm-details', icon: <Server className={iconClass} />, title: 'BTM Machine Details' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { name: 'QBO Entries', path: '/qbo-entries', icon: <BookOpen className={iconClass} />, title: 'QBO Entries', adminOnly: true },
      { name: 'Refunds', path: '/refunds', icon: <Undo2 className={iconClass} />, title: 'Refunds', adminOnly: true },
      { name: 'Settings', path: '/settings', icon: <Settings className={iconClass} />, title: 'Settings' },
    ],
  },
];

export function Sidebar() {
  const { isCollapsed, setIsCollapsed } = useSidebar();
  const { role } = useAuth();
  // null while loading or on error — the badge hides rather than showing a
  // misleading "0", which would read as "nothing to chase".
  const pendingCount = usePendingCount();

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.adminOnly || role === 'admin'),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-border bg-elevated transition-all duration-200",
        isCollapsed ? "w-[72px]" : "w-[252px]"
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex min-h-16 border-b border-border",
          isCollapsed
            ? "flex-col items-center justify-center gap-2 px-2 py-3"
            : "items-center gap-2.5 py-4 pl-4 pr-3.5"
        )}
      >
        <img
          src="/Denet Favicon.png"
          alt="Denet"
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 rounded-full"
        />
        {!isCollapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight tracking-tight text-foreground">
              Denet Analytics
            </div>
            <div className="text-[11px] font-medium text-dim">BTM operations</div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors",
            "hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !isCollapsed && "ml-auto"
          )}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main">
        {visibleGroups.map((group, gi) => (
          <div key={group.label} className={cn(isCollapsed && gi > 0 && "mt-2 border-t border-border pt-2")}>
            {!isCollapsed && (
              <div className="px-2.5 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const badgeCount =
                  item.showPendingBadge && pendingCount !== null && pendingCount > 0
                    ? pendingCount
                    : null;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end
                    title={
                      isCollapsed
                        ? badgeCount
                          ? `${item.title} (${badgeCount} awaiting resolution)`
                          : item.title
                        : undefined
                    }
                    className={({ isActive }) =>
                      cn(
                        "relative flex items-center gap-2.5 rounded-lg text-[13.5px] font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isCollapsed ? "justify-center py-2.5" : "px-2.5 py-[7px]",
                        isActive
                          ? "bg-primary/15 font-semibold text-primary"
                          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                      )
                    }
                  >
                    {item.icon}
                    {!isCollapsed && <span className="truncate">{item.name}</span>}
                    {badgeCount !== null && (
                      <span
                        className={cn(
                          "flex items-center justify-center rounded-full bg-primary text-[11px] font-bold tabular-nums text-primary-foreground",
                          // Collapsed: float over the icon. Expanded: sit at the row end.
                          isCollapsed
                            ? "absolute right-1.5 top-1 h-4 min-w-4 px-1"
                            : "ml-auto h-[18px] min-w-[18px] px-[5px]"
                        )}
                      >
                        {badgeCount}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
