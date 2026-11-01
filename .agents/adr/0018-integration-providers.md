# ADR-0018: Choose the v1 integration providers

## Status

Accepted — 2026-10-30.

## Context

v1 depends on external services for trust, delivery and diagnosis: credential
verification, email, maps, language models and observability. The current code treats some
as optional and falls back to mocks or local data, which was acceptable for a demo and is
not acceptable for real candidates and employers.

The choices must be replaceable, auditable and operable by a small team.

## Decision

| Capability | v1 provider | Fallback | Rule |
|---|---|---|---|
| Credential verification | Accredible, then Credly | Certo adapter if the organization self-hosts it; mock only in development | An unverified credential is never presented as verified |
| Transactional email | Resend behind our own adapter | SMTP | The SQL outbox is the source of truth; delivery is a side effect |
| Maps | Google Maps (Distance Matrix + Geocoding) | Local matrix only in development and tests | Production never invents a distance |
| Language model | OpenRouter with paid models and per-capability budget | Heuristic extractor and deterministic replies | The model never decides a hard constraint |
| Errors | Sentry | Structured logs | Every error carries `trace_id` |
| Traces | OpenTelemetry across web, runtime and worker; Langfuse for agent spans | Internal audit log | A missing trace never blocks a decision |
| Vacancy supply | Operator upload (CSV or internal API) | Last valid upload with visible freshness | No scraping in v1 |
| Courses | Training-center portal | Seed catalog in development | Expired courses leave the roadmap |

## Consequences

- The mock path is gated by environment: outside development and tests it is refused or
  flagged, never silently used.
- Every integration sits behind an interface owned by this repository, so a provider
  change does not touch domain code.
- Resend needs a verified domain and bounce handling; the outbox retry lives in the
  operator panel.
- Google Maps becomes a production requirement; the local matrix is explicitly a
  development aid.
- Sentry and OpenTelemetry add instrumentation work to web, runtime and worker.
- Object storage for CV files is still undecided; the recommended option is Cloudflare R2
  or S3 with signed URLs and a retention rule.

## Alternatives

- **Self-hosted Certo as the primary verifier.** Rejected: adds an AGPL service to operate
  and a pinned clone to maintain; kept as an adapter.
- **Manual verification by the counselor.** Rejected: does not scale and mixes evidence
  with human judgement.
- **Amazon SES.** Rejected for v1: cheaper at volume but more operational setup than the
  team needs now.
- **SMTP only.** Rejected: no managed templates or bounce webhooks.
- **Logs only, no Sentry/OTel.** Rejected: three services make cross-service diagnosis
  impractical.
- **Scraping job portals.** Rejected: terms of use, fragility and dirty data.

## Links

- `docs/stack.md`
- ADR-0003 (verification and human approval), ADR-0014 (blockers), ADR-0017 (modules)
