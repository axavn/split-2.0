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

### 3.6 A real bug we shipped: RLS infinite recursion

The first version of these policies died at runtime with *"infinite recursion
detected in policy for relation bill_shares"* — a bug worth studying because
it's *the* classic RLS mistake:

- the `bills` read-policy asked "does the viewer have a row in `bill_shares`?"
- the `bill_shares` read-policy asked "is the viewer the payer in `bills`?"

Postgres applies RLS to the subqueries *inside policies* too, so evaluating
either policy triggered the other, forever. Neither policy is wrong on its
own — the *pair* is.

The standard fix (now in the schema): wrap each cross-table check in a
`security definer` function (`is_bill_payer`, `is_bill_participant`).
Such functions run as their owner, and table owners bypass RLS, so the lookup
inside the function doesn't re-enter policy evaluation — cycle broken. The
functions return only a boolean, so they don't become a data leak, and
`execute` is granted only to `authenticated`.

Takeaway: whenever two tables' policies need to reference each other, at
least one side must go through a `security definer` helper (or a view with
RLS disabled). If you see "infinite recursion detected in policy", look for a
policy cycle.

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

## 9. The 2.1 release (from Alex's testing journal)

Six changes driven by actually using the app. What each one teaches:

### 9.1 Decimal amounts — and why not `parseFloat`

The integer-only input was a spec misread; money obviously needs cents. The
fix is *not* `parseFloat(x) * 100`: floats strike again (`4.56 * 100 ===
455.99999…`). `parseAmountToCents` splits the string with a regex —
`"42.5"` → dollars `42`, cents `"5".padEnd(2,'0')` = `50` → `4250` — pure
integer math end to end. The input gate regex loosened from `^\d*$` to
`^\d*\.?\d{0,2}$`. Nothing else changed: the database was storing cents all
along, so a UI-layer fix was the whole fix. That's the payoff of picking the
right representation early.

### 9.2 Display names: identity vs. handle

`profiles` gained `display_name`. The username stays unique — it's the
*handle* (login, adding people); the display name is the *identity* ("Alex
Nguyen"). Splitting these is standard design (GitHub, Twitter, Discord all do
it) because names collide and change, while handles must be unique and
stable-ish. The migration backfills existing users' display names from their
usernames; the signup trigger now reads both from auth metadata.

### 9.3 Friend requests: a status column, not a new table

A request and a friendship are the same relationship at different stages, so
`connections` just gained `status: pending → accepted` rather than a separate
requests table (which would need moving rows across tables on accept). New
RLS rules encode the social contract: only the *recipient* may update
(accept), and either side may delete (decline / cancel). Balances and bills
only count accepted connections — enforced in the client queries, with RLS
still guaranteeing nobody sees strangers' data.

### 9.4 Password change requires the old password

Supabase's `updateUser({password})` only requires a valid session — so a
borrowed unlocked phone could change your password. The fix: re-authenticate
with `signInWithPassword(currentEmail, oldPassword)` first; only if that
succeeds do we set the new one. "Confirm new password" is a pure client-side
typo check — it never needs the server.

### 9.5 iOS without the App Store: PWA

"Installable on iPhones without a complicated process" = a Progressive Web
App. Safari's *Add to Home Screen* turns the site into a standalone
full-screen app. What makes it work:

- `manifest.webmanifest` with `display: "standalone"` + PNG icons (Android/
  desktop Chrome read this)
- `apple-touch-icon.png` + `apple-mobile-web-app-*` meta tags (Safari
  largely ignores the manifest and reads these instead; iOS won't take SVG
  icons, hence the generated PNGs)
- `viewport-fit=cover` + `env(safe-area-inset-bottom)` padding so the bottom
  nav clears the iPhone home indicator in standalone mode

A real App Store build later = wrap this same site in Capacitor (needs a Mac
+ $99/yr Apple Developer account). The PWA is the right v1.

### 9.6 The redesign — and how to edit the UI yourself

The claymorphism theme is gone in favor of Alex's identity: off-black &
off-white minimalism, Work Sans (UI) + Dongle (display), squared corners,
borders instead of shadows, color used *only* for balance direction.

`src/index.css` is now structured for hand-editing — the entire look derives
from the token block at the top of the file:

- **Change a color/font/radius once** in `:root` and everything follows.
  That's the design-token pattern; it's how real design systems work.
- **Hierarchy without color:** in a monochrome UI you create emphasis with
  size, weight, and one inverted element (the off-white primary button).
  Resist adding accent colors — the green/red balances pop *because*
  they're the only color on screen.
- **Dongle quirk:** it renders visually small with huge built-in line
  spacing, so it's used at ~2× the size you'd expect with `line-height:
  0.75`. Display fonts often need this kind of tuning.
- **Borders vs shadows:** minimal UIs separate surfaces with 1px hairlines
  (`--border`) on barely-different background tones. If you want depth back,
  reintroduce `box-shadow` on `.card`/`.person-button` and lighten borders.

Good exercises: change `--radius` to 12px and see the feel shift; swap
Dongle for another display font (one line in `index.html`, one token here);
make a light theme by inverting the five neutral tokens.

## 10. The 2.2 release — closing a trust gap

A code-review pass (not user testing this time) turned up one real security
issue and a few missing pieces. What each one teaches:

### 10.1 `create_bill` trusted the client too much

RLS on `bill_shares` only checked "you're the payer" — it never checked *who*
you were creating a debt against. `create_bill` is a callable RPC, so anyone
with a valid session and another user's UUID could call it directly (browser
console, a raw REST call with their own JWT) and create a `bill_shares` row
against a total stranger. That's the general RLS lesson from §3.6 again, one
layer up: a policy can be individually correct and the *system* still leaks,
because the missing check wasn't "who am I" but "who is this debt against."

The fix is `is_accepted_connection()`, a `security definer` helper in the
same family as `is_bill_payer`/`is_bill_participant`, and a loop inside
`create_bill` that raises if any participant fails that check. It runs
*before* the bill is inserted, so a rejected call leaves nothing behind.

### 10.2 Bills are now hard-deletable — payer only, no edit

There was no way to undo a mistake — wrong amount, wrong people, wrong split
— short of living with a wrong balance forever. The fix is deliberately the
simplest one that could work: a `delete` RLS policy restricted to
`created_by = auth.uid()`, a `deleteBill()` call, and a `×` button on each
transaction row you paid (gated on the new `LedgerEntry.paidByMe` flag, not
the sign of `directionCents` — a $0 share is a valid split result, so the
sign alone can't distinguish "you paid" from "they paid"). No edit form: for
two-person trust software, "delete and re-add" is one confirm dialog instead
of a second form that has to recompute shares. `bill_shares` cleans itself up
via its existing `on delete cascade` FK; the matching delete policy on
`bill_shares` is defense in depth, not load-bearing.

### 10.3 Removing a connection now requires a zero balance

There was no "unfriend" feature at all before 2.2 — `removeConnection` was
only wired to declining a still-*pending* request, which can never carry a
balance (bills require an accepted connection). Building the feature raised
the obvious question: what happens to the debt if you remove someone you've
actually split bills with? `fetchLedger` doesn't filter by connection status,
so the naive answer is "nothing — the bill_shares rows sit there, invisible,
until you re-add them," which is a surprising way to lose track of money you
owe or are owed.

The fix: `BalanceDetailPage` computes `netCents` for the page anyway (it's
already showing the balance pill), so "Remove connection" reuses that number
as a guard — nonzero balance shows an error explaining the block instead of
calling `removeConnection`. It's a client-side check, not an RLS policy,
which is the right call here: unlike §10.1 (a stranger writing debt onto you
without consent), the failure mode being guarded against is *your own*
accidental data hiding, not another party attacking you — nothing is lost
even if it were bypassed, since the underlying bills survive and reappear the
moment the connection is re-added.

### 10.4 Home Page balance direction was color-only

The 2.1 redesign (§9.6) deliberately dropped the "owe"/"collect" words from
the Home Page and left just a big colored number — but that made the
direction color-only on that one screen, unlike Balance Detail Page (which
has both a text line and a signed `+`/`−` amount on every transaction). A
colorblind user had no secondary cue there. The fix is the smallest one that
doesn't reintroduce clutter: a leading `+`/`−` sign, borrowed directly from
the convention `BalanceDetailPage` already uses, instead of new copy or a
different color pair.

### 10.5 Known, deliberately deferred

Two things came up that aren't worth fixing yet, written down so they're a
tracked decision instead of a forgotten one:

- **`fetchLedger`/`fetchConnections` fetch everything, every load.** The
  Home Page's "infinite scroll" (§6, `useInfiniteList`) paginates an
  already-fully-loaded in-memory array — the query itself has no
  `.range()`/`.limit()`. Fine at this scale (see §5.1); if a single user's
  `bills` ever crosses roughly 500 rows, move `fetchLedger` to a paginated
  Postgres view/RPC before page loads get noticeably slow.
- **Username search leaks existence.** `sendRequest`'s error message tells
  you whether a username is registered, with no rate limiting. Low stakes
  (usernames aren't secret, RLS still protects real data) and not worth
  the UX cost of a generic error message for a two-person trust app.

## 11. What's deliberately not here

- **Receipt OCR (§7.2)** — needs a paid parsing API (Veryfi/Taggun). The
  schema, `bills.source` flag, and the Add Bill page are shaped so the scan
  flow can slot in: scan → OCR returns line items → editable checkbox list →
  per-item person assignment writes `bill_shares` rows with `bill_item_id`.
- **Settle up / payments** — the spec scopes Splitly to *tracking* balances,
  not moving money.
- **Realtime updates** — balances refresh on page load. Supabase has a
  realtime channel feature that could push new bills live; unnecessary for v1.
