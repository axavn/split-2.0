# Splitly — Design & Build Specification

## 1. Overview

Splitly is a shared expense tracker. Users add other people, log bills (manually or by scanning a receipt with OCR), and Splitly maintains a running balance with each person — who owes whom and how much. No real money moves through the app; it only tracks and displays balances.

**Core model: person-to-person balances.** Unlike group-based apps, Splitly's home screen is a list of *people* the user has added. Each person has one net balance with the current user, updated every time a bill involving them is confirmed.

## 2. Tech Stack

- **Frontend:** React (Vite), mobile-first responsive web app / PWA.
- **Hosting:** Netlify (auto-deploy from Git repo).
- **Backend:** Supabase — Auth (login), Postgres (users, connections, bills, balances), Storage (receipt images). Row Level Security so users only see their own data.
  - Note: Supabase Auth is email-based under the hood. The UI shows "username"; implement username as a unique field on the user profile that maps to the account (or use email as the login identifier and display name as username — decide at build time, keep the UI label "Username").
- **Receipt OCR:** receipt-parsing API that returns structured line items (Veryfi or Taggun recommended; Google Cloud Vision as fallback with custom parsing).
- **Styling:** Claymorphism aesthetic (see §9).

## 3. Login Page

- Layout is centered **both vertically and horizontally** on the screen.
- **"SPLITLY"** in big letters, centered horizontally, positioned **above** the input fields.
- Below the title, stacked vertically:
  1. **Username** input field (on top)
  2. **Password** input field (below it)
  3. Log in button
- Include a small "Create account" link for new users (sign-up collects username + password; minimal friction).
- On successful login → go **directly to the Home Page** (no intermediate screen). Session persists so returning users skip login.

## 4. Bottom Navigation Bar

A persistent bar fixed to the **bottom of the screen**, visible on all main pages:

| Position | Icon | Destination |
|---|---|---|
| Left | Home icon | Home Page |
| Middle | Plus (+) icon | Add Page |
| Right | Gear icon | Account Page |

## 5. Home Page

Infinite-scroll layout listing every person the user has added.

**Header area:**
- Top of screen, aligned right: a line of text reading **"Welcome [username]"**.
- Below the welcome line: three **rounded pressable filter buttons lined up horizontally**:
  - **"Owe"** — show only people the user owes money to.
  - **"Collect"** — show only people who owe the user money.
  - **"All"** — show everyone (default).

**Person list:**
- Below the filters: a vertically stacked list of **long, rounded, horizontally stretched pressable buttons** — one per added person.
- Inside each button:
  - **Top right:** the other user's name.
  - **Right middle:** the balance with that person (amount owed to them / amount to collect from them).
- The list is **infinitely scrollable**: every time the user adds another person, a new button appears in this list, so it grows without limit and paginates/lazy-loads as the user scrolls.
- Pressing a person's button navigates to that person's **Balance Detail Page** (§6).

## 6. Balance Detail Page (per person)

Opened by tapping a person on the Home Page.

- **Top right of the screen:** the other person's name.
- Below that: a line reading **"You owe..."** or **"You collect..."** depending on the direction of the balance.
- Underneath: a **non-pressable button** (static pill/badge) displaying the balance amount:
  - Text is **green** if the balance is positive (they owe you / you collect).
  - Text is **red** if the balance is negative (you owe them).
- Below the balance: an **infinitely scrollable list of all transactions** between the current user and this person — each entry showing the item/description, amount, direction, and date, newest first.

## 7. Add Page (+ tab)

Two pressable buttons, **stacked vertically**, each navigating to its own page:

1. **"Add Bill"** → Add Bill Page (§7.1)
2. **"Add Person"** → Add Person Page (§7.3)

### 7.1 Add Bill Page

**Top of page:** a pressable button **stretched horizontally across the page** labeled **"Scan receipt"** with a **plus icon on the right side inside the button**. Pressing it launches the Scan Receipt flow (§7.2).

**Below that: Manual Entry section**, where the main user:
1. Enters the **item** (description).
2. **Selects the people** involved (from their added people).
3. Enters **how much they paid** — input **only allows integers** (validate/reject decimals and non-numeric input).
4. Chooses one of two options:
   - **Split evenly** among the selected people, or
   - **Full price** — the selected person/people pay the full amount.
5. When the user selects **Split**, an additional button appears: **"Include yourself"** — when toggled on, the cost is split evenly among the selected people **plus the current user**; when off, only the selected people split it.
6. A **Confirm** button saves the bill.

**Balance update rule (applies to every confirmed bill, manual or scanned):** when a bill is confirmed, the shared balance between the current user and each involved user is immediately recalculated and updated with the correct amounts (their share added to what they owe the payer, netted against any existing balance in the other direction), and the new balances are reflected on the Home Page and Balance Detail Pages.

### 7.2 Scan Receipt Page

1. Pressing **"Scan receipt"** opens the **camera** (with gallery upload as fallback for browsers/devices where direct camera access is limited).
2. The captured image is sent to the **OCR** service, which reads the receipt and returns the total and line items. Show a processing/loading state.
3. Results screen layout:
   - **Total displayed at the top.**
   - Below it: a **checkable menu (list with checkboxes)** of the different items parsed from the receipt.
4. **Per-item assignment:** when the user taps **one item** in the list, a **small dropdown menu** appears with the people they can select from; selecting a person adds **that one item's price** to that person's balance with the current user. Repeat for each item as needed.
5. **Alternative — split evenly:** instead of assigning items individually, the user can choose to **split the entire check evenly across multiple selected users**.
6. Confirming applies the balance update rule from §7.1.
7. Because OCR is imperfect, item names/prices in the checkable menu should be editable before confirming.

### 7.3 Add Person Page

- Add another Splitly user by their username (search/enter exact username), or generate an invite link for someone without an account.
- Once added, the person immediately appears as a new button on the Home Page with a starting balance of $0.

## 8. Account Page (gear tab)

A **simple layout** with the user's account fields:
- **Name (username)** — viewable/editable.
- **Password** — change password field/flow.
- Log out button.

## 9. Visual Design: Claymorphism

All UI elements follow a claymorphism aesthetic — soft, puffy, clay-like components:

- **Shapes:** generous border-radius (16–32px) on all buttons, cards, inputs — including the long person buttons on Home, the filter pills, and the bottom nav.
- **Shadows:** dual soft shadows — light top-left highlight + dark bottom-right depth, e.g. `box-shadow: -6px -6px 12px rgba(255,255,255,0.7), 6px 6px 12px rgba(0,0,0,0.15);`
- **Press feedback:** pressable buttons switch to an inset shadow on tap ("pressed into the clay").
- **Palette:** warm pastel background (cream/lavender/mint), 1–2 accent colors; **green for positive balances, red for negative balances** as specified in §6; off-white and charcoal instead of pure white/black.
- **Typography:** rounded sans-serif (Quicksand, Nunito, or Poppins); big bold rounded "SPLITLY" wordmark on the login page.
- **Icons:** rounded/filled style (Lucide or Phosphor fill) for the home, plus, and gear nav icons.

## 10. Data Model (Supabase / Postgres)

```
profiles
  id (uuid, pk, = auth user id)
  username (unique)
  created_at

connections                 -- "added people": a link between two users
  id (uuid, pk)
  user_a (fk -> profiles.id)
  user_b (fk -> profiles.id)
  created_at
  -- net balance between the pair is derived from bill_shares (see below)

bills
  id (uuid, pk)
  created_by (fk -> profiles.id)   -- the payer
  description
  total_amount (integer)           -- integer-only per spec
  source (manual | receipt_scan)
  split_type (even | full_price | by_item)
  include_self (boolean)           -- for even splits
  receipt_image_url (nullable)
  created_at

bill_items                  -- receipt line items (source = receipt_scan)
  id (uuid, pk)
  bill_id (fk -> bills.id)
  item_name
  price

bill_shares                 -- one row per person per bill: what they owe the payer
  id (uuid, pk)
  bill_id (fk -> bills.id)
  user_id (fk -> profiles.id)
  bill_item_id (fk -> bill_items.id, nullable)   -- set when assigned per-item
  amount_owed
```

**Balance calculation:** net balance between user X and user Y = (sum of `amount_owed` in bills X paid where Y has a share) − (sum of `amount_owed` in bills Y paid where X has a share). Positive → Y owes X ("Collect", green). Negative → X owes Y ("Owe", red). Home Page filter buttons query on the sign of this net balance.

## 11. Build Order

1. Scaffold Vite + React + Supabase, deploy placeholder to Netlify.
2. Login page (SPLITLY wordmark, centered username/password) + sign-up + session persistence.
3. Bottom nav shell + routing (Home / Add / Account).
4. Add Person flow + connections table.
5. Home Page: welcome line, Owe/Collect/All filters, infinite-scroll person list with balances.
6. Manual Add Bill flow (item, people, integer amount, split evenly / full price, "Include yourself") + balance update logic.
7. Balance Detail Page (name top right, owe/collect line, green/red balance pill, transaction history).
8. Scan Receipt flow: camera/upload → OCR API → total + checkable item list → per-item dropdown assignment or even split → confirm.
9. Account Page (username, password change, log out).
10. Claymorphism styling pass, press animations, empty/loading/error states, PWA manifest.
