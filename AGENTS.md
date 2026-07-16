# Split 2.0

Shared expense tracker with real accounts: React + Vite + TypeScript frontend,
Supabase (Auth + Postgres + RLS) backend, claymorphism UI, deployed to Netlify.
Built from `splitly-design-spec.md`; receipt OCR (§7.2) is deferred.

The user (Alex) is learning software engineering — when changing this codebase,
explain the reasoning behind decisions, and keep `WALKTHROUGH.md` up to date; it
documents why every layer is built the way it is.

## Commands

- `npm run dev` — Vite dev server on http://localhost:5174
- `npm run build` — `tsc -b` type-check + static `dist/`
- `npm run lint` — oxlint

## Ground rules

- **Money is integer cents everywhere.** Format to dollars only at render
  (`src/lib/money.ts`). Never use floats for amounts.
- **Balances are derived from `bill_shares`, never stored.** Don't add a
  balances table or cache; see WALKTHROUGH §3.2.
- **Multi-row writes go through Postgres RPCs** (like `create_bill`), not
  sequential client inserts — atomicity.
- **RLS is the security boundary.** Client-side checks are UX only. Any new
  table in `supabase/schema.sql` needs policies before it ships.
- Schema changes: `supabase/schema.sql` is the source of truth; it's written
  to be run once on a fresh project. If you change it, note that existing
  projects need the delta applied manually.
- Login is username-based on top of Supabase email auth via synthetic
  `<username>@splitly.local` addresses (WALKTHROUGH §4.1). Username changes
  must update auth email + profile together.
- The folder name contains a space; the dev server may be launched via the
  8.3 alias `SPLIT2~1.0`, which is why `vite.config.ts` sets
  `server.fs.strict: false` (dev-only). Don't remove it without retesting.
