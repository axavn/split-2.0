import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';

import { requireSupabase, supabase } from './supabase';

export type Profile = { id: string; username: string };

// Supabase Auth authenticates with email + password. The spec wants a
// username login, so each account gets a synthetic, deterministic email
// derived from the username. Users never see it; it only exists so we can
// reuse Supabase's battle-tested password auth instead of rolling our own.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const USERNAME_RULES = '3–20 characters: lowercase letters, numbers, _';

function usernameToEmail(username: string): string {
  return `${username}@splitly.local`;
}

function normalizeUsername(raw: string): string | null {
  const username = raw.trim().toLowerCase();
  return USERNAME_RE.test(username) ? username : null;
}

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  // These return a user-displayable error message, or null on success.
  signIn: (username: string, password: string) => Promise<string | null>;
  signUp: (username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  updateUsername: (newUsername: string) => Promise<string | null>;
  changePassword: (newPassword: string) => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: restore any persisted session (supabase-js keeps it in
  // localStorage, which is what makes "returning users skip login" work),
  // then subscribe to later auth changes (sign-in, sign-out, token refresh).
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Whenever the session changes, load the matching profile row. If the row
  // isn't there yet (the DB trigger creates it during signup), fall back to
  // the username we stashed in auth metadata so the UI never shows a blank.
  useEffect(() => {
    if (!session || !supabase) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('id, username')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const fallback = session.user.user_metadata?.username as string | undefined;
        setProfile(
          (data as Profile | null) ??
            (fallback ? { id: session.user.id, username: fallback } : null),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      signIn: async (rawUsername, password) => {
        const username = normalizeUsername(rawUsername);
        if (!username) return `Invalid username (${USERNAME_RULES})`;
        const { error } = await requireSupabase().auth.signInWithPassword({
          email: usernameToEmail(username),
          password,
        });
        if (error) {
          return error.message === 'Invalid login credentials'
            ? 'Wrong username or password'
            : error.message;
        }
        return null;
      },
      signUp: async (rawUsername, password) => {
        const username = normalizeUsername(rawUsername);
        if (!username) return `Invalid username (${USERNAME_RULES})`;
        if (password.length < 6) return 'Password must be at least 6 characters';
        // Username uniqueness is ultimately enforced by the DB constraint,
        // but checking first gives a friendly error instead of a failed signup.
        const sb = requireSupabase();
        const { data: taken } = await sb
          .from('profiles')
          .select('id')
          .eq('username', username)
          .maybeSingle();
        if (taken) return 'That username is taken';
        const { error } = await sb.auth.signUp({
          email: usernameToEmail(username),
          password,
          options: { data: { username } },
        });
        return error ? error.message : null;
      },
      signOut: async () => {
        await requireSupabase().auth.signOut();
      },
      updateUsername: async (rawUsername) => {
        const username = normalizeUsername(rawUsername);
        if (!username) return `Invalid username (${USERNAME_RULES})`;
        if (!session) return 'Not signed in';
        const sb = requireSupabase();
        const { data: taken } = await sb
          .from('profiles')
          .select('id')
          .eq('username', username)
          .neq('id', session.user.id)
          .maybeSingle();
        if (taken) return 'That username is taken';
        // The login email is derived from the username, so both must change
        // together or the user couldn't log back in. Auth first (it's the
        // credential), then the visible profile row.
        const { error: authError } = await sb.auth.updateUser({
          email: usernameToEmail(username),
          data: { username },
        });
        if (authError) return authError.message;
        const { error: profileError } = await sb
          .from('profiles')
          .update({ username })
          .eq('id', session.user.id);
        if (profileError) return profileError.message;
        setProfile({ id: session.user.id, username });
        return null;
      },
      changePassword: async (newPassword) => {
        if (newPassword.length < 6) return 'Password must be at least 6 characters';
        const { error } = await requireSupabase().auth.updateUser({
          password: newPassword,
        });
        return error ? error.message : null;
      },
    }),
    [session, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
