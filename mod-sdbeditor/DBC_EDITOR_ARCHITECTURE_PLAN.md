# Mod-SDBEditor Codebase Architecture Plan

Status: Draft v1.0
Owner: Server Tooling
Scope: Entire `mod-sdbeditor` codebase (web app, APIs, data pipelines, export/backup flow, server control integration)

## 1) Vision
Build a production-grade private-server operations platform around `mod-sdbeditor`, where content editing, validation, packaging, and deployment are unified in one safe and scalable web system.

## 2) Product Goals
- Provide one coherent admin experience for content editing, server operations, and release prep.
- Keep all base data safe while allowing fast iteration on large content sets.
- Support both generic tooling and domain-specific editors.
- Offer reliable export artifacts for deployment to client/server.
- Enable long-term maintainability via modular architecture and phased delivery.

## 3) In-Scope Domains
- Data domain: DBC editing, icon management, manifests/indexes, validation.
- Operations domain: starter/auth, health/status, restart/task workflows.
- Release domain: export packaging, backup/snapshot, deployment readiness.
- UX domain: specialized editors + generic editor + settings/admin controls.

## 4) Non-Goals (Initial)
- Direct write-through to live production server data folders.
- True realtime collaborative editing in v1.
- Full CI/CD orchestration outside current workspace.

## 5) Architectural Principles
- Safety first: immutable inputs, controlled outputs, explicit sync boundaries.
- Deterministic outputs: repeated runs produce the same artifacts.
- Progressive performance: cache hot paths, use incremental update mechanisms.
- Observability by default: clear status, errors, and diagnostics surfaces.
- Domain-led UI: high-frequency workflows optimized first.

## 6) System Context

### 6.1 Runtime Components
- Frontend app (React/Vite): editors, settings, validation/reporting UX.
- Backend API (`server.js`): file I/O, processing pipelines, domain endpoints.
- Starter/auth service (`starter-server.js`): server control and access workflows.
- Data processors: DBC parser/updater, icon manifest/index/sync utilities.

### 6.2 Persistence and File Topology
- Base sources (`web/public/*`): synced inputs and static assets.
- Outputs (`mod-sdbeditor/export/*`): edited deploy-ready artifacts.
- Backups (`mod-sdbeditor/backups/*`): daily and manual snapshots.
- Config + cache (`web/public/config.json`, indexes/manifests/icon-list cache).

## 7) Logical Architecture

### 7.1 Data Plane
- Parsers/adapters
  - DBC binary read/write, schema definitions, type coercion.
- Index/cache layer
  - Spell-name/index/icon maps, icon list cache, manifest cache.
- Validation layer
  - Binary safety, schema conformance, referential checks, domain rules.
- Artifact generation layer
  - Export DBC/icon outputs, manifests, thumbnails (on-demand), sprite sheets.

### 7.2 Control Plane
- Admin/API orchestration
  - Sync/rebuild actions, bulk operations, health checks, restart tasks.
- Job orchestration
  - Async background tasks, progress/status, retries and diagnostics.
- Audit/trace (phase later)
  - Action history, change metadata, release notes traceability.

### 7.3 Presentation Plane
- Domain editors (Talent, SpellIcon, etc.).
- Generic DBC editor for long-tail tables.
- Validation center + diff/review hub.
- Release/deployment panel with artifact readiness status.

## 8) Capability Roadmap

### Phase A: Foundation Hardening (Now)
- Normalize path model (base/output/backup) across all services.
- Ensure binary-safe read/write invariants for all DBC touchpoints.
- Complete endpoint ordering and routing reliability.
- Add integrity checks for generated key artifacts.

### Phase B: Core Platform Unification
- Standardize service contracts (response shape, error model, job status model).
- Consolidate duplicated logic from legacy endpoints/scripts.
- Introduce central task runner patterns for expensive operations.

### Phase C: Robust Editing Platform
- Harden generic DBC editor with schema-aware constraints.
- Expand specialized editors with shared validation + save framework.
- Add staged changes and record-level diff review before final export.

### Phase D: Validation & Quality Gates
- Multi-level validation (binary, schema, referential, domain).
- Export gating: block unsafe releases, allow warning-only bypass rules.
- Validation report artifacts for release records.

### Phase E: Performance & Scalability
- Incremental file watchers and cache warming.
- Avoid full rescans for common operations.
- Add profiling points and latency budgets for hot API endpoints.

### Phase F: Release Management & Operations
- Snapshot/rollback workflows integrated into UI.
- Release checklist and artifact promotion states.
- Optional packaging automation hooks for patch deployment.

## 9) Reliability Strategy
- Atomic writes (temp + fsync + rename where feasible).
- Pre-change backups for critical files.
- Startup self-check for required directories and key artifacts.
- Corruption detection endpoints for high-risk files.

## 10) Security & Safety Strategy
- Strict path allowlist + traversal prevention.
- Role-gated privileged actions (sync, export overwrite, restart, deploy).
- Input size and type constraints across upload and save endpoints.
- Sensitive operation logging and redaction policy.

## 11) Performance Strategy
- Cached icon list and manifest pipelines.
- Precomputed indexes for high-frequency lookups.
- On-demand expensive transforms (e.g., thumbnails) with explicit triggers.
- Background jobs for long-running tasks with progress state.

## 12) Operating Model
1. Sync source data from trusted locations.
2. Edit through domain/generic editors.
3. Run validation suite and review deltas.
4. Generate export artifacts.
5. Snapshot release.
6. Deploy to server/client workflows.
7. Rollback from snapshot if needed.

## 13) Engineering Standards
- Shared response envelope for all APIs.
- Shared error taxonomy (user error vs system error vs corruption risk).
- No direct live-data writes.
- Tests for parser/writer invariants and critical endpoints.
- Backward-compatible migrations for config/cache structure.

## 14) Milestones (High-Level)
- M1: Foundation hardening complete.
- M2: Unified service contracts + task framework.
- M3: Editing platform + staged diff review.
- M4: Validation gates + release workflow.
- M5: Performance budgets and observability targets.

## 15) Open Requirements (To Fill Together)
1. Top product priorities across the whole app (not only DBC).
2. Mandatory release gates vs optional warnings.
3. Single-admin vs team model and permission matrix.
4. Required rollback speed and retention policy.
5. Preferred release cadence and maintenance windows.
6. Scope boundary with `surrealui.aio` integration points.

## 16) Immediate Next Step
After your requirements pass, convert this into a concrete execution spec:
- component-by-component architecture map,
- API contract matrix,
- data flow diagrams,
- and sprint plan with acceptance criteria.
