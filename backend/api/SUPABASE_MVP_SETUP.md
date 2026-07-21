# Supabase MVP setup

## Authentication policy

NarraOps presents a phone-number-and-password UI for the MVP. Hosted Supabase
requires an SMS provider before its native Phone provider can be enabled, even
when phone confirmation is disabled. Because this MVP intentionally sends no
SMS, it uses Supabase Email/Password internally with a deterministic private
login alias derived from the normalized phone number.

- Leave the Phone provider disabled.
- Keep the Email provider enabled.
- Disable email confirmation.
- Do not configure an SMS provider or SMTP service for this MVP flow.
- Normalize every phone number to E.164 format before signup and sign-in.

The application converts the normalized phone number to an internal email-like
alias before calling Supabase Auth. The same conversion must be used for signup
and sign-in. The real normalized phone is also sent in signup metadata so the
profile trigger can store it in `public.profiles`.

The phone number remains an unverified login identifier. It must not be treated
as proof of phone ownership, a recovery channel, MFA, KYC, or an anti-fraud
signal. Password reset is unavailable until a verified recovery method is
added.

## Database setup

Run `database/migrations/008_supabase_mvp_auth_analytics.sql` once in the
Supabase SQL Editor. It creates:

- `profiles`: product-facing user information.
- `user_stats`: small per-user counters for the MVP.
- `analytics_events`: an auditable append-only event stream.
- RLS policies that isolate each user's rows.
- An Auth trigger that creates profile and statistics rows on signup.
- `record_analytics_event`, an authenticated RPC that records an event and
  updates the corresponding counter in one transaction.

## Runtime configuration

The frontend may receive only the project URL and Supabase publishable key.
The secret/service-role key is server-only and is not required for basic
client signup, login, profile reads, or the analytics RPC.

Never commit real Supabase keys. Keep local values in ignored environment
files and production values in the hosting provider's secret manager.

## Client calls

Signup:

```js
const normalizedPhone = normalizePhoneToE164(phone);
const loginAlias = phoneToInternalEmail(normalizedPhone);

await supabase.auth.signUp({
  email: loginAlias,
  password,
  options: {
    data: {
      phone: normalizedPhone,
      display_name: displayName,
      auth_identifier_kind: "unverified_phone_alias",
    },
  },
});
```

Sign-in:

```js
await supabase.auth.signInWithPassword({
  email: phoneToInternalEmail(normalizePhoneToE164(phone)),
  password,
});
```

Record usage:

```js
await supabase.rpc("record_analytics_event", {
  requested_event_name: "narrative_viewed",
  requested_properties: { narrative_id: narrativeId },
});
```
