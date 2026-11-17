# Availa Admin

Admin site for the [Availa](https://github.com/) booking platform. It is a separate project that uses the **same Supabase project**
as the Availa app. Read `docs/ADMIN-SPEC.md` for everything it does and why.

Stack: React 19, TypeScript, Vite, Supabase. Same design tokens as the main app (green brand, Poppins, light and dark).

## Setup (about 15 minutes)

### 1. Database
Open the Supabase **SQL Editor** for your Availa project and run the whole of `supabase/admin-setup.sql`.
It is safe to run twice. Read any `NOTICE` lines it prints: one says a table was skipped because row level security is off.

### 2. Create your first admin
Make an account first (Supabase > Authentication > Add user, or sign up in the Availa app). Then in the SQL Editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

Do the same for each teammate. Remove an admin by setting the role back to `client`.
Turn on **multi-factor authentication** in Supabase for these accounts.

### 3. Edge Functions
These need the same secrets Availa already uses (`PAYSTACK_SECRET_KEY`, `ID_HMAC_KEY`). Optionally set `MAIN_APP_URL`
(the public Availa URL) so password reset emails link back to the right place.

```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy admin-id-review admin-money admin-user --no-verify-jwt
```
`--no-verify-jwt` is fine: each function checks the caller is an active admin itself.

### 4. Run the site
```bash
cp .env.example .env.local     # fill in your project URL and anon key
npm install
npm run dev                    # http://localhost:5174
```
Deploy like the main app (Vercel works: `vercel.json` is included). Use a separate URL, for example `admin.yourdomain.com`.
Add that URL to Supabase > Authentication > URL configuration.

**Never put the `service_role` key in `.env.local` or in the browser.**

## First-run checklist (please do this before trusting it)
1. Sign in with a normal client account. You should be refused.
2. Sign in as an admin. The overview loads without errors.
3. As a normal client in the Availa app, try this in the browser console. It must fail:
   `await supabase.from('profiles').update({ role: 'admin' }).eq('user_id', '<your id>')`
4. Make a test booking, cancel it from the admin site, and confirm the refund behaves as you expect (test payment mode first).
5. Open the Audit log and confirm your actions appear.

## Notes
- Written against the schema in `nailbook.sql` plus what the app and Edge Functions use. Later migrations
  (payments, payouts, ID checks...) were not in the upload, so some column names were inferred from code. If the SQL file errors,
  the message names the column; adjust that line and run again.
- `src/lib/db.ts` is the only place that talks to the database in bulk; `supabase/functions/` is the only place with the service key.
