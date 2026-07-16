import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Vite injects env vars prefixed with VITE_ at build time (see .env.example).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// True once real values are in .env — the app renders a setup checklist
// instead of crashing when they're missing (e.g. a fresh clone).
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('YOUR-PROJECT'),
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!)
  : null;

// For code paths that only run behind auth, where the client must exist.
export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured — see .env.example');
  return supabase;
}
