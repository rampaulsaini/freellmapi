# Isolated public showroom

This directory is a static, read-only catalogue presentation. It does not run the FreeLLMAPI application, access its database, handle provider credentials, accept enquiries, or process payments.

## Build

Run:

```sh
node scripts/build-public-showroom.mjs
```

Set `SHOWROOM_API_BASE_URL` to the HTTPS origin/base URL of the separately deployed FreeLLMAPI API before building. The generated `config.js` contains only that public URL; never put secrets in it. If the variable is absent, the site deliberately shows an unconfigured state and does not fabricate sample products.

The API deployment must separately allow the static site's exact origin in `DASHBOARD_ORIGINS` for browser CORS. The API's `GET /api/showroom/records` route is read-only and only returns records marked verified with a non-empty declared license, an HTTPS source URL, and an enabled source.

## Publishing verified records to the isolated database

The authenticated admin endpoint `POST /api/discovery/showroom/publish` copies only currently verified records with a non-empty license, an HTTPS source URL, and an enabled source into the separate Supabase `showroom_records` table. It withdraws previously published rows before rebuilding the eligible public set. The endpoint requires a dashboard session.

Configure these variables only on the trusted FreeLLMAPI server (never in this static site's build variables or browser code):

- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the server-only service-role secret. Never expose it to clients, commit it, or place it in `public-showroom/config.js`.

The publisher uses bounded batches and an idempotent upsert keyed by source and external ID. If the variables are absent, publishing returns a configuration error and does not publish data. The isolated database's anonymous role has SELECT-only access, constrained by RLS; writes are server-side only.

## Trust and scope

The “verified” label reports the catalogue's recorded review state; it is not an independent audit or legal certification of a license. The site has no login, signup, customer data collection, enquiry form, proposal, payment, or delivery workflow.

## Render static site

Use this repository, the `main` branch, build command `node scripts/build-public-showroom.mjs`, and publish directory `public-showroom`. Configure the non-secret `SHOWROOM_API_BASE_URL` build environment variable only after the API has been deployed and its HTTPS URL has been smoke-tested. Keep the static site and API as separate services.
