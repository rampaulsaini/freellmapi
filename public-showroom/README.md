# Isolated public showroom

This directory is a static, read-only catalogue presentation. It does not run the FreeLLMAPI application, access its SQLite database, accept enquiries, or process payments.

## Build

Run:

```sh
node scripts/build-public-showroom.mjs
```

Choose one data source:

### Direct Supabase read-only mode (recommended)

Set these build-time variables:

- `SHOWROOM_SUPABASE_URL`: the HTTPS Supabase project origin.
- `SHOWROOM_SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key (or legacy anon key).

The generated browser config contains only the project URL and publishable/anon key. These keys are designed for public clients and are safe only with the least-privilege grants and RLS policies verified on the table. Never put a service-role or secret key in this static site.

The frontend reads only `public.showroom_records` through the Supabase Data API, filtering for `is_published=true` and `verification_status=verified`. RLS further limits visible rows to eligible records. The public role has SELECT only; it cannot write. The page uses bounded pagination and does not collect visitor data.

### Existing HTTPS API mode

Alternatively, set `SHOWROOM_API_BASE_URL` to the HTTPS origin/base URL of a separately deployed FreeLLMAPI API before building. The API deployment must allow the static site's exact origin in `DASHBOARD_ORIGINS`. Its `GET /api/showroom/records` route is read-only and only returns records marked verified with a non-empty declared license, an HTTPS source URL, and an enabled source.

## Publishing verified records to the isolated database

The authenticated admin endpoint `POST /api/discovery/showroom/publish` copies only currently verified records with a non-empty license, an HTTPS source URL, and an enabled source into the separate Supabase `showroom_records` table. It withdraws previously published rows before rebuilding the eligible public set. The endpoint requires a dashboard session.

Configure these variables only on the trusted FreeLLMAPI server (never in this static site's build variables or browser code):

- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the server-only service-role secret. Never expose it to clients, commit it, or place it in `public-showroom/config.js`.

The publisher uses bounded batches and an idempotent upsert keyed by source and external ID. If the variables are absent, publishing returns a configuration error and does not publish data.

## Trust and scope

The “verified” label reports the catalogue's recorded review state; it is not an independent audit or legal certification of a license. The site has no login, signup, customer data collection, enquiry form, proposal, payment, or delivery workflow.

## Hosting

Use this repository, the `main` branch, build command `node scripts/build-public-showroom.mjs`, and publish directory `public-showroom`. Configure the two non-secret Supabase build variables only after the public site's security configuration has been verified. Keep the static site and API as separate services.
