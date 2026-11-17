# Availa Admin: functions and capabilities

This is the plan the admin site was built from. It was drafted after reading the whole Availa codebase
(schema, data layer, Edge Functions, pages, styles). Section 6 lists what is deliberately left out.

## 1. Who it is for and the guiding rules

Availa has clients and nail artists, and money moves between them (deposits, refunds, payouts). The
admin site is for the small team that runs the platform. Four rules shaped every decision:

1. **Same backend, separate site.** It uses the same Supabase project as the Availa app, but is its own project
   with its own URL. A bug here can't break the public app, and the public app never ships admin code.
2. **The database decides what an admin may do, not the browser.** Hiding a button is not security. Every admin
   privilege is enforced by `is_admin()` and row level security (`supabase/admin-setup.sql`).
3. **Anything that needs a secret runs on the server.** Viewing ID photos, moving money and suspending accounts go through
   Edge Functions. The browser only ever has the public anon key.
4. **Everything leaves a trail.** Every change an admin makes is written to an audit log the admin cannot edit. Reading private data
   (a chat, an ID photo) needs a reason or is logged by name.

## 2. Roles and access

| Who | Can do |
| --- | --- |
| Admin | Everything in this document. |
| Everyone else | Nothing. Signing in with a non-admin account is refused and signed out straight away. |

- An admin is a profile with `role = 'admin'` that is not suspended.
- Admins are added and removed **only in the database** (SQL Editor). The browser cannot change anyone's role, on purpose.
- Sessions end after 30 minutes without activity.
- Recommended: turn on multi-factor authentication for admin accounts in Supabase.

## 3. Modules

### 3.1 Overview
- **Needs attention** tiles that link to each queue: ID checks waiting, open reports, support messages, refunds needing attention,
  failed payouts, hidden reviews.
- Headline numbers: clients, artists (visible / without ID check), bookings today, money collected (30 days),
  completed value (30 days), Availa fees (30 days and all time), suspended accounts.
- Charts (14 / 30 / 90 days): new bookings, money collected, completed appointments, new accounts.
- Breakdowns: bookings by status, popular services, artists by location, top artists.

### 3.2 Users
- Search by name, email, phone, city. Filter by role (client, artist, admin) and by status (suspended, deactivated, has reports).
- Open any person for a full panel: contact details, last sign-in, bookings, reports against them.
- Actions: edit name, phone, city (and business name, location, bio, Instagram for artists); send a password reset email;
  suspend and reinstate; email directly.
- **Suspending** blocks sign-in at Supabase Auth, signs them out when their session ends, hides an artist from Find Artists, and records
  a mandatory reason. Nothing is deleted, so bookings, payments and reviews stay intact.
- Export to CSV (logged).

### 3.3 Artists
- Directory view with ID check state, visibility on Find Artists, rating, bookings.
- In the panel: toggle visibility and "accepting bookings", remove an inappropriate gallery photo (with reason), see services and
  prices, see the artist's earnings by state (held, available, in payout, paid out, refund due).

### 3.4 ID checks (human review)
The automatic check in Availa sends doubtful cases to a person. This is that person's screen.
- Queue sorted by how soon the photo will be auto-deleted (red under 12 hours).
- Shows **why** a person is needed in plain words (photo hard to read, name mismatch, document already used on another account...).
- The photo is **hidden until you click Open**, then shown for 60 seconds from a short-lived link, next to what the artist typed.
- Decisions: **Approve** (makes the artist verified and visible), **Ask for a new photo**, **Reject** (optionally block the document).
- Approving needs the photo to have been opened. Rejecting needs a note. Approving a document already tied to another account needs an explicit override.
- Keeps the promises made to artists: the photo and typed details are deleted the moment a decision is made; only a scrambled fingerprint of the ID number is kept.
- Full history of each check, including every time an admin opened the photo.

### 3.5 Bookings
- All bookings, with filters for status, date range and search by client, artist or service.
- Special filter: **cancelled after the session started** (flagged for review in the business rules).
- Booking panel: who, when, price, deposit, paid, balance, hold expiry, notes, house-call address, payments, refunds.
- Actions: cancel a booking (reason required; then sends any refund the database decided), mark no-show, send waiting refunds,
  read the private chat (reason required, access logged).
- Export to CSV (logged).

### 3.6 Money
Four tabs:
- **Payments:** every card payment with status, provider and reference. Opens the booking.
- **Refunds:** "Needs attention" view (due, failed, processing). **Send** asks Paystack to pay; **Settle by hand** records the outcome of a refund that is
  stuck on *processing* after you checked Paystack. A refund can never be sent twice.
- **Payouts:** all payouts to artists with bank and failure reason. **Settle by hand** for a payout stuck on *processing*.
- **Artist balances:** per artist, card payments, Availa fee, held, available, in payout, paid out, refund due.
- Export payments to CSV (logged).

### 3.7 Services
- Add, rename, edit length, delete. Shows how many artists offer each, and which were added by artists themselves.
- A service with bookings can't be deleted (rename it instead).

### 3.8 Trust and safety
- **Reports:** queue with reporter, reported person, reason, details, linked booking. Status (open, investigating, actioned, dismissed), internal notes,
  jump to the person's panel to suspend them.
- **Reviews:** filter all / 1-2 stars / hidden. **Hide** removes a review from the artist's profile and rating without deleting it; **Delete** is permanent. Reason required.
- **Support inbox:** messages from Contact and Help. Reply by email, set status, keep internal notes.

### 3.9 Settings
- **Payment mode** (off / test / Paystack) with a warning and mandatory reason.
- **Payments and payouts:** deposit %, slot hold minutes, Availa fee %, smallest payout, wait after bank details change.
- **ID check rules:** review window, upload clean-up, attempts per day, smallest photo, text confidence, name match thresholds.
- **Admin team** list, with how to add one.
- Every value is range-checked before saving.

### 3.10 Audit log
- Who did what, to what, when, with before and after values for data changes.
- Filters: accounts, ID checks, money and bookings, private data access, data changes.
- Cannot be edited or deleted from the site.

### 3.11 Everywhere
- Find any person from the top bar. Light and dark theme like the main app. Works on phones (menu slides in, tables scroll).
- Live badges in the sidebar for the queues that need attention.

## 4. Safety design (the short version)

| Risk | How it is handled |
| --- | --- |
| Someone makes themselves admin | A database trigger blocks role changes from the browser. Roles change only in the SQL Editor. |
| An artist marks themselves verified or edits their rating | The same trigger blocks those columns for non-admins. |
| Admin data visible to the public | Every admin view ends in `where is_admin()`; anonymous access is revoked. |
| Service key leaks | It is never in the browser. Only Edge Functions use it, and each checks the caller is an admin. |
| ID photo copied | Hidden until clicked, 60-second link, every view logged by name. (A browser can't truly stop screenshots; policy matters too.) |
| Refund or payout sent twice | Refunds are claimed atomically by the database before Paystack is called; a failed call leaves the refund on *processing* instead of retrying blindly. |
| Admin snooping in chats | Reading a chat needs a written reason and is logged. |
| Unattended session | 30-minute idle sign-out. |
| Spreadsheet formula injection | CSV export neutralises cells that start with = + - or @. |

## 5. Build order used

1. Database: admin role, protections, audit, views, functions. 2. Edge Functions. 3. Design system and shell.
4. Detail panels (user, booking). 5. Pages in order of risk: ID checks, money, then the rest.

## 6. Left out on purpose (and why)

- **Deleting a user.** In the current schema, deleting an account cascades to its bookings and payments, which would destroy financial records.
  Suspend instead. A proper erasure process (anonymise personal data, keep the ledger) should be designed with a lawyer, for POPIA.
- **Promoting admins from the site.** Doing it in the database means a stolen admin session can't create more admins.
- **Admin-initiated refunds outside the cancellation policy.** The refund rules live in database functions that weren't in the upload.
  Needs those first.
- **Editing prices or amounts on bookings and payments.** Financial history should not be rewritable from a UI.
- **Messaging users inside the site.** Email replies cover it for now.

## 7. Ideas for later
Two-person approval for big refunds or payment-mode changes; saved filters; email notifications when a queue gets old; per-artist payout statements; a Paystack reconciliation report.
