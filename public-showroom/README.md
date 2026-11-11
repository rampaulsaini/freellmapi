# Isolated public showroom

This directory is a static, read-only catalogue presentation. It does not run the FreeLLMAPI application, access its database, handle provider credentials, accept enquiries, or process payments.

## Build

Run:

```sh
node scripts/build-public-showroom.mjs
```

Set `SHOWROOM_API_BASE_URL` to the HTTPS origin/base URL of the separately deployed FreeLLMAPI API before building. The generated `config.js` contains only that public URL; never put secrets in it. If the variable is absent, the site deliberately shows an unconfigured state and does not fabricate sample products.

The API deployment must separately allow the static site's exact origin in `DASHBOARD_ORIGINS` for browser CORS. The API's `GET /api/showroom/records` route is read-only and only returns records marked verified with a non-empty declared license, an HTTPS source URL, and an enabled source.

## Trust and scope

The “verified” label reports the catalogue's recorded review state; it is not an independent audit or legal certification of a license. The site has no login, signup, customer data collection, enquiry form, proposal, payment, or delivery workflow.

## Render static site

Use this repository, the `main` branch, build command `node scripts/build-public-showroom.mjs`, and publish directory `public-showroom`. Configure the non-secret `SHOWROOM_API_BASE_URL` build environment variable only after the API has been deployed and its HTTPS URL has been smoke-tested. Keep the static site and API as separate services.
