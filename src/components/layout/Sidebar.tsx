import { useNavigate, useLocation } from 'react-router-dom';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/contexts/SidebarContext';
import { usePendingCount } from '@/components/pending/pending-count';

interface NavItem {
  name: string;
  path: string;
  icon: React.ReactNode;
  title: string;
  // When true, the actionable pending-resolution count renders as a badge.
  showPendingBadge?: boolean;
}

const navItems: NavItem[] = [
  {
    name: 'Dashboard',
    path: '/',
    icon: <Home className="w-5 h-5" />,
    title: 'Dashboard'
  },
  {
    name: 'CSV Uploads',
    path: '/csv-uploads',
    icon: <Upload className="w-5 h-5" />,
    title: 'CSV Uploads'
  },
  {
    name: 'Pending Resolution',
    path: '/pending-resolution',
    icon: <Clock className="w-5 h-5" />,
    title: 'Pending Resolution',
    showPendingBadge: true
  },
  {
    name: 'Reports',
    path: '/reports',
    icon: <BarChart3 className="w-5 h-5" />,
    title: 'Reports'
  },
  {
    name: 'Commissions',
    path: '/commissions',
    icon: <Calculator className="w-5 h-5" />,
    title: 'Commission Calculator'
  },
  {
    name: 'Cash Management',
    path: '/cash-management',
    icon: <Banknote className="w-5 h-5" />,
    title: 'Cash Management'
  },
  {
    name: 'Bitstop Commissions',
    path: '/bitstop-commissions',
    icon: <TrendingUp className="w-5 h-5" />,
    title: 'Bitstop Commissions'
  },
  {
    name: 'BTM Machine Details',
    path: '/btm-details',
    icon: <Server className="w-5 h-5" />,
    title: 'BTM Machine Details'
  },
{
    name: 'Liquidity',
    path: '/liquidity',
    icon: <Wallet className="w-5 h-5" />,
    title: 'Liquidity'
  },
  {
    name: 'Settings',
    path: '/settings',
    icon: <Settings className="w-5 h-5" />,
    title: 'Settings'
  }
];

export function Sidebar() {
  const { isCollapsed, setIsCollapsed } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  // null while loading or on error — the badge hides rather than showing a
  // misleading "0", which would read as "nothing to chase".
  const pendingCount = usePendingCount();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-card border-r border-white/10 transition-all duration-300 z-50 flex flex-col",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header/Logo Area */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-white/10">
        {!isCollapsed && (
          <h1 className="text-lg font-bold text-foreground">BTM Analytics</h1>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            isCollapsed && "mx-auto"
          )}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = isActive(item.path);
          const badgeCount =
            item.showPendingBadge && pendingCount !== null && pendingCount > 0
              ? pendingCount
              : null;
          return (
            <Button
              key={item.path}
              variant={active ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start transition-all relative",
                isCollapsed ? "px-2" : "px-4",
                active
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              onClick={() => navigate(item.path)}
              title={
                isCollapsed
                  ? badgeCount
                    ? `${item.title} (${badgeCount} awaiting resolution)`
                    : item.title
                  : undefined
              }
            >
              <span className={cn(isCollapsed ? "mx-auto" : "mr-3")}>
                {item.icon}
              </span>
              {!isCollapsed && (
                <span className="text-sm font-medium">{item.name}</span>
              )}
              {badgeCount !== null && (
                <span
                  className={cn(
                    "flex items-center justify-center rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold tabular-nums",
                    // Collapsed: float over the icon. Expanded: sit at the row end.
                    isCollapsed
                      ? "absolute top-1 right-1 h-4 min-w-4 px-1"
                      : "ml-auto h-5 min-w-5 px-1.5"
                  )}
                >
                  {badgeCount}
                </span>
              )}
            </Button>
          );
        })}
      </nav>

      {/* Footer - Optional branding or version */}
      {!isCollapsed && (
        <div className="p-4 border-t border-white/10 text-xs text-muted-foreground text-center">
          v1.0.0
        </div>
      )}
    </aside>
  );
}
