# Global Customer Operations & Bulk Delivery Platform

## Goal

Extend the existing FreeLLMAPI Catalog Lab into the same platform's customer-facing operations workspace. The first capacity target is **1,000 independently isolated customer accounts**, not 1,000 concurrent requests claimed without a load test.

Customers must be able to submit work and authorized data, define the analysis they need, inspect results, collect approved outputs, place individual or bulk orders, and receive delivery through email and WhatsApp where the customer has explicitly opted in.

## Existing-system boundary

- Keep the existing single-owner FreeLLMAPI dashboard, provider credentials, unified API key, model routing, and local SQLite installation working.
- Do not expose the operator's provider keys, unified API key, logs, backups, or another customer's data to customer accounts.
- The existing dashboard session system is an operator/admin login, not a completed multi-tenant SaaS identity layer. Do not treat the current `users` table as proof of tenant isolation.
- Catalog Lab remains the shared model catalogue and model-selection surface. Customer workspaces consume approved models through server-side routing; customer browsers never receive provider secrets.

## Target workflow

1. **Customer onboarding** — verified email, optional WhatsApp number, explicit channel consent, locale/time zone, organization/workspace, role and plan.
2. **Work request** — customer selects a service/template, uploads or connects only data they are authorized to use, supplies purpose, output format, deadline and retention choice.
3. **Inspection & analysis** — validate file type/size/schema, scan uploads, classify data sensitivity, preview records, detect duplicates, profile quality, and show a human-readable preview before processing.
4. **Collection** — normalize accepted records into a tenant-scoped dataset with source, consent/authorization reference, timestamps, provenance, validation results and version.
5. **Order management** — quote/approval, order line items, quantity, price snapshot, status, idempotency key, batch grouping, cancellation/refund state and delivery manifest.
6. **Bulk processing** — durable queue, bounded workers, per-tenant concurrency and quotas, retries with backoff, dead-letter handling, progress counters and resumable batches. Never hold a web request open for a large batch.
7. **Bulk delivery** — versioned output files or secure expiring links, per-item success/failure manifest, checksum, delivery receipt and retry only for failed items.
8. **Notifications** — provider-neutral email and WhatsApp adapters; transactional templates, delivery status, retry policy, opt-out/suppression, audit trail and per-channel consent. No marketing messages by default.

## Core data boundaries

Every customer-owned record must carry a non-null `tenant_id` and be queried through a tenant-scoped service. Enforce authorization in the API/service layer and, where supported by the selected database, database row-level security. Tenant ownership must be checked for uploads, datasets, analysis jobs, orders, order items, exports, delivery links, notification preferences and audit events.

Suggested entities:
- tenants, tenant_members, invitations, roles
- customer_profiles, contact_channels, consent_events
- data_sources, uploads, datasets, dataset_versions, dataset_records
- analysis_templates, analysis_jobs, analysis_results
- orders, order_items, order_batches, payment_events
- delivery_manifests, delivery_items, notification_events
- usage_quotas, idempotency_keys, audit_events

Do not store raw card data. Payment provider events must be verified and idempotent. Do not persist WhatsApp/email provider credentials in customer-visible records.

## Architecture direction

- Separate the existing operator/admin control plane from the customer workspace plane.
- Introduce a tenant-aware identity and authorization layer; do not turn first-run single-user setup into unrestricted public signup.
- Use a managed relational database suitable for shared multi-tenant hosting (PostgreSQL is the target); keep SQLite for existing local/single-owner installs until a separately tested migration path exists.
- Store uploaded files in private object storage, not public static directories. Use short-lived signed download URLs and malware/content validation.
- Use a durable background job queue and worker process for imports, analysis, bulk orders, exports and notifications.
- Keep email and WhatsApp integrations behind interfaces so providers can be configured without coupling order logic to one vendor. WhatsApp requires approved business setup/templates and user opt-in; email also requires verified sender/domain and unsubscribe/suppression handling where applicable.
- Add per-tenant rate limits, quotas, storage limits, worker concurrency, fair scheduling and abuse controls.
- Minimize personal data, encrypt in transit and at rest, redact secrets/PII from logs, support export/deletion/retention policies, and record access to sensitive datasets.

## Capacity and acceptance criteria

The 1,000-customer target is accepted only after repeatable staging load tests demonstrate:
- 1,000 provisioned tenants with strict cross-tenant isolation tests.
- A documented concurrent-active-user and request-rate target, measured rather than implied by account count.
- Mixed workload tests for upload, preview, analysis, order creation, batch processing, exports and notifications.
- No cross-tenant reads/writes in automated authorization tests, including guessed IDs and background jobs.
- Bounded queue growth, fair per-tenant scheduling, safe retries and no duplicate orders/deliveries under replay.
- Measured p50/p95/p99 latency, error rate, queue wait time, throughput, storage use and per-job cost.
- Restore, backup, deletion and incident/audit procedures tested.
- Email and WhatsApp sandbox/delivery tests with consent and opt-out cases.

## Delivery phases

1. **Foundation and threat model** — tenant data model, roles, isolation tests, secure onboarding and audit events.
2. **Data intake and inspection** — private uploads, CSV/JSON import, schema mapping, validation, preview, dedupe and dataset versioning.
3. **Analysis workspace** — customer-defined templates, model routing, result review, provenance and export.
4. **Orders and bulk fulfillment** — quotes, approval, order batches, queue workers, manifests, resumable delivery.
5. **Email and WhatsApp** — consent capture, templates, provider adapters, status webhooks, opt-out and retry.
6. **Scale verification and launch** — 1,000-tenant staging test, security review, operational dashboards, deployment and public smoke tests.

## Explicit non-claims

This specification does not mean multi-tenancy, 1,000-customer capacity, bulk delivery, email, WhatsApp, payments or production deployment are already implemented. Each capability must be marked complete only after code, automated tests, staging evidence and operational verification exist.
