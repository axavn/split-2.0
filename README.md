# Split 2.0

Splitly rebuilt around real accounts: add people by username, log bills
(split evenly or full price), and keep a running person-to-person balance —
who owes whom, in green and red. React + Vite frontend, Supabase (auth +
Postgres) backend, claymorphism design, deployable to Netlify.

> Learning this codebase? **[WALKTHROUGH.md](./WALKTHROUGH.md)** explains every
> implementation decision — why the schema looks the way it does, how balances
> are derived, how username login works on top of email auth, and more.

## One-time backend setup (~5 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. Dashboard → **SQL Editor** → paste all of [`supabase/schema.sql`](./supabase/schema.sql) → **Run**.
3. **Authentication → Sign In / Providers → Email** → turn **off** "Confirm email"
   (logins use usernames mapped to synthetic addresses; confirmation mail can't arrive).
4. **Project Settings → API** → copy the **Project URL** and **anon public** key.
5. `cp .env.example .env`, paste both values in.

Until step 5 is done, the app renders this same checklist instead of the login page.

## Develop

```bash
npm install
npm run dev        # http://localhost:5174
```

## Build & deploy

```bash
npm run build      # type-check + static dist/
npm run preview    # serve the production build locally
npm run lint       # oxlint
```

Netlify: connect the repo (settings auto-read from [`netlify.toml`](./netlify.toml)),
then add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under
**Site settings → Environment variables** and deploy.

## Install it on your phone (iOS / Android)

Splitly is a PWA — no App Store needed:

- **iPhone/iPad:** open the site in **Safari** → tap the **Share** button →
  **Add to Home Screen** → **Add**. It launches full-screen with its own icon.
- **Android:** open the site in Chrome → menu (⋮) → **Add to Home screen** /
  **Install app**.

## What's in 2.1

- ✅ Username/password accounts, persistent sessions
- ✅ Display names (first + last at signup, editable) on top of unique usernames
- ✅ Friend requests — adding someone sends a request they accept or decline
- ✅ Manual bills: even split (optional "include yourself") or full price,
  amounts with up to 2 decimals
- ✅ Home page with Owe / Collect / All filters, wordless green/red balances,
  infinite scroll
- ✅ Per-person balance detail with full transaction history
- ✅ Account page: display name, username, old→new→confirm password change, log out
- ✅ Installable on phones (PWA) — see above
- ⏳ Receipt scanning (OCR) — deliberately deferred; the schema (`bills.source`,
  `bill_items`, `bill_shares.bill_item_id`) is already shaped for it.

## Upgrading an existing database

Fresh Supabase projects just run `supabase/schema.sql`. A database created
before 2.1 needs the one-shot migration: paste
[`supabase/migration-2.1.sql`](./supabase/migration-2.1.sql) into the SQL
Editor and run it (adds `profiles.display_name` and `connections.status`).
