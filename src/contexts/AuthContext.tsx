import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: 'admin' | 'standard' | null;
  signIn: (email: string, password: string, rememberMe: boolean) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Role source of truth: app_metadata only.
//
// user_metadata is writable by the user it describes — supabase-js exposes
// `auth.updateUser({ data: { role: 'admin' } })` — so it is never read here.
// app_metadata is writable only through the admin API (the admin-users Edge
// Function). The database enforces the same rule via public.is_admin(); this
// value only decides what the UI shows.
//
// A signed-in user with a missing or unknown role is 'standard' — least
// privilege. null means signed out.
const roleOf = (session: Session | null): 'admin' | 'standard' | null => {
  const user = session?.user;
  if (!user) return null;
  const appRole = (user.app_metadata as Record<string, unknown> | undefined)?.role;
  return appRole === 'admin' ? 'admin' : 'standard';
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<'admin' | 'standard' | null>(null);

  useEffect(() => {
    // Check active sessions and sets the user
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setRole(roleOf(session));
      setLoading(false);
    });

    // Listen for changes on auth state (sign in, sign out, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setRole(roleOf(session));
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string, rememberMe: boolean) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: {
          // If rememberMe is true, session lasts 7 days, otherwise it's a session cookie
          persistSession: rememberMe,
        },
      });

      if (error) {
        return { error };
      }

      // If rememberMe is false, set session expiry to browser close
      if (!rememberMe && data.session) {
        // Session will expire when browser closes (handled by Supabase)
        // Default behavior when persistSession is true but we want browser-session only
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value = {
    user,
    session,
    loading,
    role,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
