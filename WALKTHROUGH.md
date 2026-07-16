# Split 2.0 — Implementation Walkthrough

This document explains every significant decision in the codebase: what was
built, why it was built that way, and what the alternatives were. Read it top
to bottom and you'll understand the whole system.

---

## 1. Architecture: why there's no server in this repo

The spec calls for accounts, shared data, and receipt storage — that's a
backend. The classic answer is "write a Node/Express API + a database + auth
middleware + hosting for all of it." We instead use **Supabase**, a hosted
Postgres with three things bolted on:

- **Auth** — password login, session tokens, refresh — solved problems you
  should almost never build yourself (password hashing, token rotation, and
  the dozen ways to get them wrong).
- **PostgREST** — an auto-generated REST API over your tables. The browser
  talks *directly* to the database through it.
- **Row Level Security (RLS)** — the reason direct-from-browser is safe at
  all. See §3.

So the architecture is: **static React site (Netlify CDN) ⇄ Supabase**.
There is no server of ours to patch, scale, or pay for. The tradeoff: complex
business logic has fewer places to live (client, SQL, or Postgres functions) —
fine at this size, and §3.4 shows where server-side logic goes when needed.

## 2. Tooling choices

- **Vite + React + TypeScript**: Vite is today's standard build tool — instant
  dev-server startup, and `npm run build` emits a plain static `dist/` any CDN
  can host. TypeScript in `strict` mode catches whole bug classes (nulls,
  typos in field names) at compile time — this repo has zero `any`.
- **tsconfig project references** (`tsconfig.app.json` / `tsconfig.node.json`):
  app code and build-config code run in different worlds (browser vs Node), so
  they get different type environments. `tsc -b` checks both.
- **react-router-dom**: three of the spec's pages are URL-addressable
  (`/person/:userId` must survive a refresh). The `netlify.toml` SPA redirect
  makes the CDN serve `index.html` for every path so client routing works on
  direct hits.
- **oxlint**: fast Rust-based linter, zero-config.
- **lucide-react**: the spec (§9) asks for rounded icons for Home/Plus/Gear;
  Lucide is tree-shakeable (only the 5 icons used end up in the bundle).

## 3. The database (`supabase/schema.sql`)

### 3.1 Money is integer cents — always

Floats can't represent most decimal fractions exactly (`0.1 + 0.2 !==
0.3`), and money code built on floats accumulates one-cent drift. Every
amount column is an `integer` count of cents; conversion to `"$12.34"`
happens only at render time (`src/lib/money.ts`). The UI's whole-dollar rule
(spec §7.1) is enforced separately at the input layer (§6.3).

### 3.2 Balances are derived, never stored

The tempting design is a `balances` table updated whenever a bill is saved.
Its fatal flaw: two sources of truth. If an update is missed, doubled, or
raced, the stored balance disagrees with the bills forever, and nobody can say
which is right.

Instead, `bill_shares` rows ("X owes the payer N cents for bill B") are the
single source of truth, and the net balance between you and a person is
*recomputed* as:

```
  sum(their shares on bills you paid) − sum(your shares on bills they paid)
```

positive → they owe you (green "Collect"); negative → you owe them (red
"Owe"). The spec's "balance update rule" (§7.1) becomes a non-feature: saving
a bill *is* the balance update, because balances are just a query over bills.

### 3.3 Row Level Security is the actual security

The browser holds the `anon` API key, which is public by design — anyone can
read it from the bundle. What stops a stranger from `select * from bills`?
RLS policies compiled into every query by Postgres itself:

- you can read a bill only if you paid it **or** you have a share on it;
- you can insert bills/shares only **as yourself** (`created_by = auth.uid()`);
- you can see a connection only if you're on either end of it.

Security lives in the database, not in the client. Client-side checks (like
the friendly "that username is taken" message) are UX, not security — the
database constraint is the enforcement.

### 3.4 Two pieces of logic live in the database on purpose

- **`handle_new_user` trigger**: when Supabase Auth creates a user, a trigger
  creates the matching `profiles` row from the signup metadata, atomically
  with the account itself. Doing this from the client would leave half-created
  accounts when the second request fails.
- **`create_bill` function (RPC)**: a bill and its shares must be saved
  together or not at all. Two separate inserts from the browser can be
  interrupted (network drop, crash) leaving a bill that charges nobody. A
  Postgres function runs in one transaction; the client calls it with
  precomputed share amounts. It's `security invoker`, so RLS still applies —
  it grants no extra power.

### 3.5 Schema details worth noticing

- `connections` has a unique index on `(least(a,b), greatest(a,b))` — a
  normalized pair, so "Alex added Sam" and "Sam added Alex" can't create a
  duplicate edge.
- `check` constraints (username format, positive amounts, no self-connection)
  are the last line of defense — they hold even if a future client has bugs.
- `bills.source`, `bill_items`, `bill_shares.bill_item_id` exist but are
  unused: they're the landing zone for the deferred receipt-OCR feature
  (spec §7.2), so adding it later needs no migration.

## 4. Auth (`src/lib/auth.tsx`)

### 4.1 Username login on top of email auth

Supabase Auth authenticates with email+password; the spec wants usernames.
Rather than build a custom auth system (dangerous), each account gets a
**synthetic, deterministic email**: `alex` → `alex@splitly.local`. Sign-up
stores the username in auth metadata (the DB trigger copies it into
`profiles`); log-in re-derives the same email from the typed username. Users
never see an email anywhere. This is exactly the spec §2 note ("keep the UI
label Username") taken to its logical end.

Consequence: changing your username must also change the synthetic email, or
you couldn't log back in — which is why `updateUsername` updates auth first,
then the profile row. It's also why the Supabase project must have
"Confirm email" turned **off**: confirmation mail to `@splitly.local` can
never arrive.

### 4.2 One context, one subscription

`AuthProvider` calls `getSession()` once on mount (restores the persisted
session — this is why returning users skip login, spec §3) and subscribes to
`onAuthStateChange` for everything after. Every page reads the same session
and profile through `useAuth()`; no component talks to auth state directly.
Functions return `string | null` (an error message or success) so pages can
render failures without try/catch ceremony.

## 5. The data layer (`src/lib/data.ts`)

### 5.1 The ledger model

Everything the UI needs is derived from one shape:

```ts
type LedgerEntry = {
  otherUserId: string;
  directionCents: number;  // + they owe you · − you owe them
  ...bill info
};
```

`fetchLedger` runs two queries — bills you paid (with everyone's shares) and
shares you owe on other people's bills — and flattens both into signed
entries. Then:

- **Home page balances** = group entries by person, sum `directionCents`.
- **Detail page history** = filter entries by person, already newest-first.
- **Owe / Collect filters** = sign of the sum.

One data model, three features. The signed-number trick (positive = inflow,
negative = outflow) is the same one double-entry bookkeeping uses, and it
means "net balance" is literally `sum()`.

At this scale, folding on the client is simpler and fast enough; if a user
someday has thousands of bills, the same computation moves into a Postgres
view without changing the model.

### 5.2 Split math (`src/lib/money.ts`)

$10.00 across 3 people is 333.33… cents — not representable. `splitCentsEvenly`
gives everyone `floor(total/n)` and hands the remainder out one cent each to
the first slots: `[334, 333, 333]`, summing *exactly* to 1000. When "Include
yourself" is on, the payer occupies the first slot — absorbing the extra
cent — and their share is then dropped, because you can't owe yourself.

The Add Bill preview uses the *same function* as the save path, so the
preview can never disagree with what's stored.

### 5.3 "Full price" interpretation

The spec says "the selected person/people pay the full amount." If that meant
"split the full amount among them," it would be identical to an even split
without yourself — a redundant button. It's implemented as: **each selected
person owes the full entered amount** (e.g. you bought three $50 tickets →
select three people, full price, 50 → each owes $50). The UI preview states
this explicitly so users can't be surprised.

## 6. React patterns used in the pages

- **Guarded shell** (`App.tsx`): one `<ProtectedShell>` route wraps every
  signed-in page — it redirects anonymous visitors and renders the persistent
  bottom nav (§4) around an `<Outlet/>`. Auth policy lives in exactly one
  place.
- **Effect cleanup with a `cancelled` flag**: every data-fetching
  `useEffect` sets a flag in its cleanup so a response that lands after
  navigation doesn't call `setState` on an unmounted page (a classic race).
- **Controlled inputs + the integer gate** (§7.1's "only allows integers"):
  the amount field accepts a change only if it matches `/^\d*$/` — invalid
  characters never *enter* state, so nothing needs validating later. Rejecting
  bad input beats validating it after the fact.
- **Infinite scroll via `IntersectionObserver`** (`useInfiniteList`): render a
  page of items plus an invisible sentinel `<div>`; when the sentinel scrolls
  into view the hook reveals the next page. No scroll-position math, no scroll
  event throttling — the browser tells us when we're near the end.
- **Failing informatively** (`SetupPage`): with no Supabase keys the app
  renders the setup checklist instead of crashing. Good systems make their
  missing-configuration state a designed state.

## 7. Claymorphism (`src/index.css`)

The whole aesthetic (§9) reduces to two shadow recipes on CSS variables:

```css
--clay-out: -6px -6px 12px rgba(255,255,255,.7),  /* highlight, top-left  */
             6px  6px 12px rgba(61,58,69,.15);    /* shadow, bottom-right */
--clay-in:  inset 4px 4px 8px …, inset -4px -4px 8px …;  /* the inverse */
```

A consistent imaginary light source sits top-left. Raised (`--clay-out`)
means *pressable*; carved (`--clay-in`) means *not pressable* — inputs, and
the static balance pill (§6 requires a non-pressable button; the inset shadow
is what makes it read as static). Every interactive element's `:active` state
swaps to the inset shadow: the "pressed into clay" feedback, in one line.
Warm cream background, lavender/mint accents, charcoal-not-black text, Nunito
at heavy weights, 20–28px radii — all §9's checklist. Green/red is reserved
exclusively for balance direction, so color always *means* something.

## 8. Deployment

`npm run build` → static files → Netlify serves them from a CDN.
`netlify.toml` holds the build command and the SPA fallback redirect. The two
`VITE_*` env vars must be set in Netlify's dashboard because they're baked in
at build time — a static site has no runtime server to read secrets from
(and neither value is secret; RLS is the protection, §3.3).

## 9. What's deliberately not here

- **Receipt OCR (§7.2)** — needs a paid parsing API (Veryfi/Taggun). The
  schema, `bills.source` flag, and the Add Bill page are shaped so the scan
  flow can slot in: scan → OCR returns line items → editable checkbox list →
  per-item person assignment writes `bill_shares` rows with `bill_item_id`.
- **Settle up / payments** — the spec scopes Splitly to *tracking* balances,
  not moving money.
- **Realtime updates** — balances refresh on page load. Supabase has a
  realtime channel feature that could push new bills live; unnecessary for v1.
