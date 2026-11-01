# Skill Creator Artifact: `parallel-issue-fleet`

- **Source:** user proposal plus the 2026-10-20 viability assessment
- **Purpose:** add a dependency-aware, resumable issue fleet between `to-tickets` and `implement`
- **Primary artifact:** `FleetRunArtifact`
- **Providers:** built-in `local-worktree`; argv-only `vm-pool`
- **Safe default:** land every validated wave through the standard publication/review/shipping flow before dispatching dependants
- **Authority boundary:** the fleet never pushes, opens or merges PRs, or closes issues
- **Integrity:** canonical ticket body normalization, per-issue claims, ancestry-verified land-by-wave, idempotent dispatch
- **Free VM provider:** GitHub Actions `ubuntu-latest` via `assets/github-actions/` and `scripts/github-actions-provider.mjs`
- **Next consumer:** validation, then Core Flow routing

Validated: `package_skill.py` passes, the 23 focused tests pass, the root projection tests pass, and the full bundle gate reports 22/22 checks with 0 warnings and 0 errors.
