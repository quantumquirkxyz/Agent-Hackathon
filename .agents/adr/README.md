# ADRs (Architecture Decision Records)

Mandatory directory for durable design decisions.

Every significant design choice made during skill development should be recorded here using the ADR format (context, decision, consequences, alternatives, status).

Rules:
- Must be created when using /grill-with-docs.
- Must reference CONTEXT.md vocabulary.
- Must not contain placeholders after publication.
- Must be reviewed before shipping.

## Index

Historical ADRs 0001, 0006, 0007 and 0008 link to `docs/old/`, a tree removed by ADR-0015.
Those links are historical references, not current documentation; the content lives in git
history.

| ADR | Decision |
|---|---|
| [ADR-0001](0001-adopt-quirk-skills.md) | Adopt the quirk Skills bundle |
| [ADR-0002](0002-employability-system-boundaries.md) | Define the employability system boundaries |
| [ADR-0003](0003-verification-and-human-approval.md) | Use layered credential verification and human-gated applications |
| [ADR-0004](0004-vacancy-catalog-seam.md) | Add a cached vacancy catalog seam for exploration |
| [ADR-0005](0005-exploration-advisory-training-roadmap.md) | Compose an advisory training roadmap from exploration evidence |
| [ADR-0006](0006-guided-chat-intake.md) | Capture the candidate profile through an LLM-guided chat |
| [ADR-0007](0007-web-styling-tailwind-shadcn.md) | Style `apps/web` with Tailwind CSS v4 and shadcn/ui |
| [ADR-0008](0008-role-organization-authorization.md) | Bind employer access to the seeded organization |
| [ADR-0009](0009-name-workbridge-and-equipo-02-tracker.md) | Name the product WorkBridge and track work in `HackathonFISC/equipo-02` |
| [ADR-0010](0010-trusted-decision-source-for-the-counselor-gate.md) | Resolve the counselor gate from a trusted decision source |
| [ADR-0011](0011-product-not-hackathon-deliverable.md) | Treat WorkBridge as a product in deployment |
| [ADR-0012](0012-tracker-quantumquirkxyz-workbridge.md) | Track work in `quantumquirkxyz/WorkBridge` |
| [ADR-0013](0013-v1-scope-national-and-dual-supply.md) | Scope v1: national coverage, broader taxonomy, two vacancy sources |
| [ADR-0014](0014-production-readiness-blockers.md) | Require seven blockers to be closed before the first real deployment |
| [ADR-0015](0015-single-root-context-and-docs-surface.md) | Use one root context and a reduced documentation surface |
| [ADR-0016](0016-stack-modernization.md) | Modernize the stack with Bun, Hono, Drizzle and a typed validation split |
| [ADR-0017](0017-v1-modules.md) | Add the operator panel, the training-center portal and the interview UI to v1 |
| [ADR-0018](0018-integration-providers.md) | Choose the v1 integration providers |
| [ADR-0019](0019-container-paas-deployment.md) | Deploy web, runtime and worker as containers on one PaaS |
| [ADR-0020](0020-anchor-organization-operating-model.md) | Operate WorkBridge through an anchor organization (B2B2C) |
