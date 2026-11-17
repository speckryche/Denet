import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface SidebarContextType {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

const STORAGE_KEY = 'denet-sidebar-collapsed';
// Session-only manual choice made while the viewport is narrow. Kept in
// sessionStorage because Layout (and this provider) remounts per route.
const NARROW_OVERRIDE_KEY = 'denet-sidebar-narrow-override';

// Below this width (laptops, 1280/1366) the sidebar defaults to icon-only so
// tables get the room. 1440×900 and wider keep the user's stored preference.
const NARROW_QUERY = '(max-width: 1439px)';

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readNarrowOverride(): boolean | null {
  try {
    const v = sessionStorage.getItem(NARROW_OVERRIDE_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function writeNarrowOverride(v: boolean | null) {
  try {
    if (v === null) sessionStorage.removeItem(NARROW_OVERRIDE_KEY);
    else sessionStorage.setItem(NARROW_OVERRIDE_KEY, v ? '1' : '0');
  } catch {
    // Storage unavailable — in-memory only.
  }
}

function matchesNarrow(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isNarrow, setIsNarrow] = useState(matchesNarrow);
  // Persisted preference — only ever written from wide viewports.
  const [storedCollapsed, setStoredCollapsed] = useState(readStoredCollapsed);
  // Session-only manual override on narrow viewports (null = auto-collapse).
  const [narrowOverride, setNarrowOverride] = useState<boolean | null>(readNarrowOverride);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      setIsNarrow(e.matches);
      // Leaving/entering narrow mode resets the session override so the
      // auto-collapse (or stored preference) takes effect again.
      setNarrowOverride(null);
      writeNarrowOverride(null);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const isCollapsed = isNarrow ? (narrowOverride ?? true) : storedCollapsed;

  const setIsCollapsed = (collapsed: boolean) => {
    if (isNarrow) {
      // Don't clobber the large-screen preference from a laptop toggle.
      setNarrowOverride(collapsed);
      writeNarrowOverride(collapsed);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // Storage unavailable — keep in-memory state only.
    }
    setStoredCollapsed(collapsed);
  };

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return context;
}
