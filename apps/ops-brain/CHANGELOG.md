# Changelog

All notable changes to AI Team OS will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [1.5.0] — 2026-05-08

### Added — Ecosystem Research Platform v2: Progressive Deep-Review Funnel

Refactored the v1.4.0 "single-pass 5-section deep-review" into a **4-stage progressive knowledge-base funnel**, making ecosystem repos accumulate research findings over time instead of one-shot reports. Designed per user spec to prevent token waste on low-value repos and to enable knowledge recall across research cycles.

- **Stage 0 — Auto shallow-summary on archive (Stage A/B)**
  - New `EcosystemShallowQueueWorker` (552 LOC) auto-dispatches `ai-engineer` agents (5 concurrent) to summarise newly-archived repos
  - Each shallow summary captures: core function / positioning / advantages / use case (200-400 chars)
  - Worker runs every 5 min, returns `DispatchIntent[]` (no direct agent spawn — Leader uses Agent tool with `team_name=ecosystem-platform`)
  - 8-class failure handling: `404→mark_deleted` / `403_private→mark_private` / `rate_limit→backoff+retry` / `5xx→exp_retry` / `agent_read→retry+swap` / `agent_timeout` / `json_parse→retry+example` / `fetch_style→pattern_record`
  - **Self-learning mechanism**: same `fetch_style` failure ≥ 3 distinct repos → auto `pattern_record(type='failure')`, future agents read lessons via `pattern_search`

- **Stage 1 — On-demand architecture analysis (Stage C)**
  - New `ecosystem_deep_review_request_batch(tags, min_stars, limit)` MCP tool
  - User picks research direction (e.g., "memory_system") → batch-dispatches `backend-architect` to read architecture key files
  - Output: `architecture_md` field + `stage_status='architecture_done'`

- **Stage 2 — Multi-perspective debate (Stage C)**
  - New `ecosystem_trigger_debate(repo_ids, research_goal)` triggers existing `debate_start` (NOT a built-in debate engine — reuses meeting system)
  - Leader has full control over debate participants and rounds (existing meeting capabilities preserved)
  - **Meeting → Ecosystem reverse-writeback hook** (`meeting_ecosystem_writeback.py`): when meeting concludes with ecosystem keyword in topic, hook reminds Leader to dispatch agent that calls `ecosystem_apply_debate_result(risks_md / learnings_md / integration_md / integration_recommendation)`
  - Output: 4 fields per finalist + `stage_status='debated'`

- **Stage 3 — Reference / Integrate marking (Stage C)**
  - `ecosystem_mark_as_reference` adds `lifecycle:reference` tag + `stage_status='referenced'`
  - `ecosystem_start_integration` adds `lifecycle:integrated` tag + creates real integration task via `task_create` (existing task system, NOT a built-in implementation engine)
  - Both paths preserve research findings for future quick recall (avoid re-deep-scanning)

### Added — Project-customizable thresholds (Stage A)

- New `EcosystemProjectSettings` table per project: `min_stars` / `top_n` / `refresh_interval_days` / `focus_topics` / `focus_languages` / `shallow_concurrency` / `deep_concurrency`
- AI Team OS default: `min_stars=5000, top_n=200, focus_topics=['claude-code','mcp','agent-framework']`
- Other projects default: `min_stars=1000, top_n=100`

### Added — Active vs Full dual-view + append-only history (Stage A/D)

- **Decision (D)**: Data is **append-only forever** — repos that fall below threshold are not deleted, just `is_active=False`. Stars climb back → auto-promoted to active set + Stage 0 re-queue
- **Decision (E)**: Periodic shallow-refresh only scans active set (top_n by stars), saving GitHub API quota
- New `EcosystemRepoStatusSnapshot` table records every scan's stars/pushed_at/is_archived/is_active for historical analysis
- New `EcosystemRefresher` service (480 LOC) provides `shallow_refresh()` (diff-based, skips repos with no push since last refresh), `recompute_active_set()`, and `resurrect()` (revives deleted/private repos when GitHub returns 200 again)

### Added — Frontend stage funnel UI (Stage E)

- List page: stage colored badges (queued/shallow_done/architecture_done/debated/referenced/integrated/_failed) + 3 tabs (active/full/deleted)
- Detail page: new "研究历程" timeline tab showing stage progression + agent outputs + `shallow_summary_history` snapshots
- New `/ecosystem/research` candidate-filtering page: input research goal → tags-based candidate list with shallow_summary preview → multi-select to trigger Stage 1 → finalists trigger Stage 2
- Project settings tab on project detail page: 8 fields (min_stars / top_n / refresh_interval_days / focus_topics / focus_languages / shallow_concurrency / deep_concurrency / auto_shallow_on_archive)
- Failed repos: red badge + "Retry now" button (calls `POST /api/ecosystem/profiles/{id}/retry`)

### Added — 11 new MCP tools

- Stage 0: `ecosystem_apply_shallow_summary`, `ecosystem_shallow_queue_status`
- Stage 1: `ecosystem_deep_review_request_batch`, `ecosystem_apply_architecture_md`
- Stage 2: `ecosystem_trigger_debate`, `ecosystem_link_debate_meeting`, `ecosystem_apply_debate_result`
- Stage 3: `ecosystem_mark_as_reference`, `ecosystem_start_integration`, `ecosystem_link_integration_task`
- Refresh: (extended `ecosystem_scan_periodic` with refresh strategy)

### Added — 8 new REST endpoints

- `/api/ecosystem/lifecycle/*` (Stage 1/2/3 trigger paths)
- `/api/ecosystem/profiles/{id}/retry` (manual retry for failed)
- `GET/PUT /api/ecosystem/projects/{project_id}/settings`
- `POST /api/ecosystem/shallow_queue/{apply_summary,tick}`, `GET /api/ecosystem/shallow_queue/status`

### Schema changes (Stage A — fully backward compatible via COLUMNS_TO_ENSURE)

- `EcosystemDeepReview` +8 fields: `stage_status` enum / `integration_md` / 4 stage timestamps / `debate_meeting_id` / `integration_task_id`
- `EcosystemRepoProfile` +8 fields: `shallow_summary` / `last_shallow_refreshed_at` / `is_deleted` / `is_private_now` / `last_fetch_error` / `fetch_failure_count` / `is_active` / `active_rank`
- 2 new tables: `EcosystemRepoStatusSnapshot` (append-only history) / `EcosystemProjectSettings` (per-project config)
- Tag dictionary: 26 → 31 (added 5 lifecycle tags: `evaluating` / `reference` / `integrated` / `deleted` / `private_now`)
- Tag source enum +1: `lifecycle` (auto-managed by Stage 3 transitions)

### Tests

- 1283+ unit tests passing (1264 baseline + 110+ new ecosystem tests across A/B/C/D/E)
- 0 regressions
- 6 pre-existing failures (CLI version flag / debate template / mcp_autostart / pipeline) verified unrelated via `git stash`

### Architecture decisions (locked from user spec)

- **(A)** Ecosystem is a **knowledge base, not a workflow engine** — Stage 2 reuses `debate_start`, Stage 3 reuses `task_create`. Ecosystem only records, recalls, and tags.
- **(B)** Meeting → ecosystem reverse-writeback hook reminds Leader to record debate verdicts back to ecosystem (preserves Leader decision authority)
- **(C)** Each project has independent thresholds + active/full dual-view
- **(D)** Data append-only forever; stars-falling repos kept for potential future revival
- **(E)** Periodic refresh only scans active set
- **(F)** Rate-limit testing-driven concurrency tuning (no preset, observed and adjusted)

### Notes

- This release is **published to GitHub only** (continuing the v1.4.0 development-milestone pattern); PyPI publication deferred until further stability validation.

## [1.4.0] — 2026-05-07

### Added — Ecosystem Research Platform (Stage A-J)

A complete project-isolated platform for discovering, tagging, and deep-reviewing the Claude/MCP/agent open-source ecosystem. 188 repos indexed in initial scan, with multi-layer tagging achieving 2.05 tags/repo average and 1.5% zero-tag rate.

- **Storage layer (Stage B)** — 5 new tables (`EcosystemRepoProfile` extended + `EcosystemDeepReview` + `EcosystemTag` dictionary + `EcosystemRepoTag` association + `EcosystemRelation` + `EcosystemScanRun`); 21 seed tags; FK CASCADE for repo deletes, RESTRICT for tag deletes; 50/50 unit tests.

- **Periodic scanning (Stage C)** — `EcosystemScanner` service with incremental strategy (skips repos scanned <7 days), full strategy, ScanRun audit trail, GitHub API graceful degradation, owner blacklist + keyword whitelist secondary filtering. 3 new MCP tools (`ecosystem_scan_periodic`, `ecosystem_scan_status`, `ecosystem_scan_history`) + 5 REST endpoints + 31 new tests.

- **Three-layer tagging (Stage D)** — Layer 1 GitHub topics direct mapping (105 hits), Layer 2 keyword rules (70 hits), Layer 3 LLM dispatch_plan mode for sub-agent fan-out. 5 new MCP tools + EcosystemTag dictionary with 26 tags (incl. capability/tech_stack/maturity/positioning categories) + 48 unit tests.

- **Multi-dim search (Stage E)** — `ecosystem_search` upgraded to 11 parameters (query/tags AND/min_stars/language/sort_by/has_deep_review/etc.), `ecosystem_repo_get` returns full profile + tags + deep_reviews + relations + scan_run, `ecosystem_search_by_capability` for tag-driven retrieval. SQLite NULLS LAST emulation, EXISTS subquery for tag AND. 38 new tests, p95 < 50ms target.

- **Deep-review workflow (Stage F)** — 5-section report template (positioning / architecture / lessons / risks / integration), `EcosystemDeepReviewer` service dispatches Explore + backend-architect agents via `dispatch_plan` (CC subagent compatible), PostToolUse `deep_review_link.py` hook auto-links saved reports to `EcosystemDeepReview.report_id`. 4 new MCP tools + 5 REST endpoints + 19 new tests.

- **Auto-summary (Stage G)** — 4 markdown summary tools: `ecosystem_summary_weekly`, `ecosystem_summary_by_tag`, `ecosystem_summary_top_n`, `ecosystem_summary_health`. Auto `report_save` with `report_type=ecosystem-{weekly,by-tag,top-n,health}`. N+1 avoided via single-pass joins. 33 new tests.

- **Frontend (Stage H)** — `/ecosystem` list page (4-col card grid + filter bar + pagination), `/ecosystem/:repoId` detail page with 4 new components (`CapabilityTags` / `DeepReviewSection` / `RelationsSection` / `ScanRunSection`), v2 API consumed via `useEcosystemRepoFull` hook (UUID → full_name resolution + path encoding). Mobile responsive, Playwright screenshots verified.

- **Project isolation (Stage J)** — All 6 ecosystem tables get nullable `project_id` column with composite UNIQUE on `(project_id, repo_full_name)` for `EcosystemRepoProfile`. `EcosystemTag` dictionary keeps `project_id=NULL` for global seed (21 tags shared across projects). `X-Project-Id` HTTP header → `get_scoped_repository` routing; MCP `_api_call` auto-injects header from cwd-inferred session project. Auto `backfill_ecosystem_to_project` startup hook migrates legacy 188 repos to AI Team OS project. Dashboard `setCurrentProjectId` syncs on project switch. 10 new isolation tests, 1109 unit tests passing.

### Added — Tag quality polish (Stage K4)

- **`replace_auto` mode** for `ecosystem_tag_apply_batch` — Replace mode (default `False` for backward compat) deletes existing `auto_rule` and `github_topic` tags before re-applying, preserving `manual` and `auto_llm` tags. Solved the bug where new rules produced new tags but stale `mcp_framework` false positives (99 repos) remained from old rule passes.

- **5 new tags + edge-case rules** — Added `claude_code` / `agent_harness` / `javascript` / `java` / `docs_only` to seed dictionary. New `LANGUAGE_TAG_MAP`, `DOCS_ONLY_LANGUAGES`, `DOCS_ONLY_NAME_PATTERNS` for Layer 2 sub-rules. `mcp_framework` false-positive rate dropped from 37% (99/265) to **0.8% (2/265)**, average tags/repo from **1.01 → 2.05**, zero-tag from **28.7% → 1.5%**.

- **18+ edge-case research** — `docs/ecosystem-tag-edge-cases.md` documents real-world tagging anomalies (n8n / dify / awesome-mcp-servers / claude-cookbooks / hermes-agent / netdata / JavaGuide) with root causes and rule fixes.

### Performance — Search optimization (Stage K1)

- **5 composite indexes** on `ecosystem_repo_profiles`: `(project_id, stars)`, `(project_id, category, stars)`, `(project_id, language, stars)`, `(project_id, pushed_at)`, `(project_id, is_archived, stars)`. EXPLAIN QUERY PLAN verified all TEMP B-TREE eliminated.

- **search p95: 2057ms → 13.1ms (156x improvement)** measured on 100 random queries (real production data, 265 repos). p50 6.6ms / p99 25ms.

- **`ecosystem_search` default behavior fixed** — Empty `tags=[]` now bypasses the EXISTS subquery (prevents full-table scan) and returns the full result set sorted by stars instead of an empty list.

- `compute_ecosystem_facet_counts` refactored to single-pass aggregation (eliminates 2/3 IO).

- 6 new performance regression tests.

### Fixed

- **`context_tracker` 1M context window detection on new model variants** — `claude-opus-4-7` and other new opus variants were misreported as 200K when actually 1M, causing false 99% context warnings at 198K tokens. Two-level detection now: (1) exact `{model}[1m]` match, (2) family-level fallback (any `claude-{opus|sonnet|haiku}-*[1m]` history triggers 1M for that family). New `CLAUDE_CONTEXT_SIZE` env var for ultimate user override. 4 new tests with module-level autouse fixture isolating `~/.claude.json` from test machine.

- **Auto-revive completed teams on new agent registration** — Hook translator now flips `team.status=completed` back to `active` when a new CC agent registers against it, with loud warning log + `team.auto_revived` event. Replaces the previous hard-block which disrupted long-running tasks (e.g., scan jobs on archived teams).

### Frontend bug fix (Stage K2)

- **Detail page `深度档案区` placeholder removed** — Previously the detail page hardcoded "TODO: Stage E v2 API" placeholder text even though the v2 API (`/profiles/{name}/full`) existed since Stage E. `useEcosystemRepoFull` hook now consumes v2 directly with UUID → full_name resolution and path-segment encoding for slashes. v2 failure gracefully degrades to v1 list-based fallback.

### Changed

- **Plugin description updated** — Now reflects 140+ MCP tools (incl. 30+ ecosystem research) + Ecosystem Research Platform feature set. New marketplace tags: `ecosystem-research`, `github-discovery`, `code-mining`.

## [1.3.4] — 2026-04-14

### Fixed
- **Critical: `meeting_send_message` 500 on databases upgraded from <1.3.0** — The 1.3.3 `_sqlite_migrate()` added `meetings.meta_json` but omitted `meeting_messages.metadata_json`. Any database created before that column was added to the ORM model would raise `OperationalError` on every `INSERT`/`SELECT` against `meeting_messages`. Fixed by refactoring `_sqlite_migrate()` into a data-driven loop over `COLUMNS_TO_ENSURE`, which also covers `meetings.meta_json`. All entries are idempotent (guarded by `PRAGMA table_info`).
- **Migration framework now data-driven** — future schema additions require only a one-line append to `COLUMNS_TO_ENSURE`.

## [1.3.3] — 2026-04-14

### Fixed
- **Critical: `meeting_create` API 500 when called from external projects** — Three root causes fixed:
  1. **Missing `meta_json` column** — The `meetings` table lacked the `meta_json` column on databases created before this field was added to the ORM model. `init_db` uses `create_all` which does not add new columns to existing tables. Added an idempotent SQLite migration in `connection.py` that runs at startup and safely `ALTER TABLE`s the column if absent.
  2. **Team ID not resolved by name** — The `POST /api/teams/{team_id}/meetings` route accepted team names (e.g. `"repo-insight-build"`) but passed them straight to the repository without UUID resolution, causing downstream queries to silently fail. Route now tries UUID lookup first, then falls back to name lookup, returning HTTP 404 if neither matches.
  3. **Unhandled ORM exception caused worker hang** — Added `try/except` around `create_meeting` call so DB errors surface as HTTP 500 JSON instead of leaving the worker stuck.

## [1.3.2] — 2026-04-14

### Fixed
- **Critical: MCP auto port discovery broken** — `plugin/.mcp.json` hardcoded `AITEAM_API_URL=http://localhost:8000` as an env var, which overrode the dynamic port fallback in `_get_api_url()`. When autostart picked a free port (e.g. 59711) because 8000 was occupied, MCP tools still tried port 8000 and reported `unhealthy`, while hooks (using the same `_get_api_url()` code path) worked correctly. Removed the env var from plugin config, root `.mcp.json`, and all install scripts so MCP now falls back to reading `api_port.txt` dynamically. User-provided `AITEAM_API_URL` env still takes priority (for remote API use cases).

## [1.3.1] — 2026-04-13

### Fixed
- **Hotfix: context_tracker 1M context window detection** — Transcripts record model as `claude-opus-4-6` without the `[1m]` suffix, causing 1M-context sessions to be treated as 200K and report absurd percentages (e.g. 342%). Added token-count fallback: if `used_tokens > 200K`, auto-detect as 1M context window.

## [1.3.0] — 2026-04-13

### Added
- **CC native integration (Track A)**
  - `TaskCompleted` hook — hard gate that blocks task completion without memo/result via `task_completed_gate.py`; exit 2 on missing progress records
  - `TaskCreated` hook bridge — `cc_task_bridge.py` auto-mirrors CC native task creations into the OS task wall
  - `PermissionDenied` hook with classifier — `permission_denied_recovery.py` calls new `POST /api/hooks/diagnose_denial` endpoint for 4-way decisions: `recoverable_with_retry`, `recoverable_with_workaround`, `needs_user_approval`, `permanent_denial`
  - MCP tool `meta={"anthropic/maxResultSizeChars": 500000}` annotations on 8 data-heavy tools (`taskwall_view`, `task_list_project`, `report_list`, `report_read`, `event_list`, `meeting_read_messages`, `memory_search`, `team_knowledge`)
  - `wake_agent` `--bare` + `--exclude-dynamic-system-prompt-sections` optimization — expected ~50% startup latency reduction with long prompt temp file fallback for Windows cmdline length limit

- **Meeting system complete redesign (Track B)**
  - `meeting_create` returns full `dispatch_plan[]` with ready-to-paste `Agent()` launch parameters, eliminating Leader impersonation by providing explicit spawn instructions per participant
  - Structured `participants` input: `{name, agent_template, role, context_files, expected_output}` replaces legacy string list (backward compatible)
  - `meeting_attendance_check(meeting_id)` — query spoken/pending participants per round with timeout tracking
  - `meeting_send_message` new `caller_agent_id` parameter — impersonation audit; mismatched calls get `impersonation: true` metadata and event log entry
  - `meeting_conclude` default `validate_attendance: true` — returns 400 with missing participant list when not all spoken; `force=true` bypasses but logs `meeting.forced_conclude_with_missing` event
  - `Meeting.meta_json` persistent field stores `expected_participants` and round state

- **Meeting templates migrated to Plugin Skills (Track C)**
  - 8 templates moved from hardcoded `templates.py` dict (234 lines) to `plugin/skills/meeting-facilitate/templates/*.md` files (brainstorm/decision/review/retrospective/standup/debate/lean_coffee/council)
  - Each template has YAML frontmatter with structured round data + markdown body (when to use / participant guide / anti-patterns)
  - `templates.py` rewritten as lazy YAML loader (107 lines), backward-compatible API
  - **User extensibility**: drop a new `.md` file to add custom meeting templates without touching Python code
  - Uses CC's progressive disclosure pattern — templates only loaded when needed, zero token penalty
  - Completely rewrote `plugin/skills/meeting-facilitate/SKILL.md` (355 lines) with 7-step lifecycle aligned to new dispatch_plan API, template selection matrix, 3 end-to-end scenarios, 7 anti-pattern warnings

- **Context tracking via transcript parsing (Plan E)**
  - New `context_tracker.py` hook on `UserPromptSubmit` — reads `transcript_path` from hook payload and extracts `usage.input_tokens` + cache tokens from the last assistant message in the session jsonl for 100% accurate context usage
  - Automatic 1M context window detection via model identifier suffix (`[1m]`)
  - Warns at `>=80%` (CONTEXT WARNING) and `>=90%` (CONTEXT CRITICAL) with token breakdown
  - **Zero dependency on statusline** — works for plugin users who don't have our custom statusline installed
  - **Natural project isolation** — transcript path itself encodes project identity, eliminating cross-project monitor file bugs

- **Project auto-registration flow**
  - New `POST /api/context/resolve` endpoint with exact/prefix/auto-create matching strategies
  - `session_bootstrap.py` detects unregistered directories and injects registration prompt to Leader (non-blocking)
  - New `dismiss_project_registration(cwd)` MCP tool — users can opt out; persisted to `~/.claude/data/ai-team-os/dismissed_projects.json`
  - Fixes the bug where new project directories (e.g., `靖安笔试`, `repo-insight`) were never registered until manually triggered

### Changed
- **Task wall auto-sync in `workflow_reminder.py`**
  - PreToolUse: extracts agent prompt + description, performs keyword matching against project task wall pending items, warns when Leader-dispatched work doesn't correspond to any wall task
  - PostToolUse: new `_post_tool_taskwall_sync()` — Agent dispatch auto-updates matching task to `running`; completion SendMessage auto-updates to `completed`
  - Narrowed report data directory warning to only `.claude/data/ai-team-os/reports/` paths (no more false positives on source code)

- **Session bootstrap context engineering**
  - Removed broken instruction to read `~/.claude/context-monitor.json` (file no longer maintained)
  - New instruction: "hook has already monitored context; you only need to focus on task progression"
  - Added project auto-registration prompt block when current cwd is unregistered

- **Documentation updates**
  - `README.md` / `README.zh-CN.md` reflects new meeting system and template architecture
  - Skill docs reorganized per CC's progressive disclosure best practices

### Fixed
- **Distribution sync** — 4 hook scripts were out of sync between `src/aiteam/hooks/` and `plugin/hooks/` (missing `_get_api_url()`, project registration checks, task wall auto-sync). Plugin users would have experienced broken dynamic port detection and silent feature loss. All 4 files now byte-identical between dev and distribution copies.
- **`meeting.py:103`** — `_build_dispatch_plan` return type annotation aligned with actual three-tuple return (added `legacy_warnings`)
- **`context-monitor.json` cross-project pollution** — old `_find_monitor_file()` globbed all projects and picked most-recent by mtime, reading stale data from other sessions. Replaced entirely by `context_tracker.py` which uses `transcript_path.parent` for natural isolation.
- **Scheduled task false warnings** — auto-wake prompt no longer reads a 9-day-old global `context-monitor.json` that falsely reported `<10%` regardless of actual usage

### Removed
- `src/aiteam/hooks/context_monitor.py` and `plugin/hooks/context_monitor.py` — replaced by `context_tracker.py`
- Global `~/.claude/context-monitor.json` dependency — no longer read or written by OS

## [1.2.1] — 2026-04-07

### Added
- **Report system database migration** — Reports now stored in SQLite database instead of filesystem; eliminates permission issues and enables project isolation
- **ReportModel ORM** — New `reports` table with `project_id`, `author`, `topic`, `report_type`, `content` fields
- **Report REST API** — `POST/GET/DELETE /api/reports` with `project_id`, `report_type`, `author` query filters
- **Dashboard full project isolation** — All 9 dashboard pages now have project selector dropdowns:
  - Reports: project selector + author filter
  - Events & Failures: project_id query parameter in events API
  - Meetings & Agent Board: frontend team.project_id filtering
  - Analytics & Pipelines: project→team cascading selectors
- **Task wall auto-sync** — `_post_tool_taskwall_sync()` in workflow_reminder: Agent dispatch auto-links to matching task wall item and updates status (pending→running→completed)
- **PreToolUse task wall matching** — Keyword overlap check between Agent prompt and project task wall items; warns when work is not tracked on the wall
- **Project cascade deletion** — `delete_project()` now cleans up 11 related tables: meetings, meeting_messages, tasks, agents, teams, phases, reports, briefings, memories, events, cross_messages

### Changed
- **`report_save` MCP tool** — Now calls `POST /api/reports` instead of writing files directly; no filesystem permission needed
- **`report_list` MCP tool** — Now calls `GET /api/reports` with server-side filtering (report_type, author, topic)
- **`report_read` MCP tool** — Now reads from database by report ID instead of filename
- **Events API** — `list_events` endpoint accepts `project_id` query parameter; filters by project's team IDs
- **Subagent context injection** — Strengthened report_save instruction: "reports must be saved via report_save tool (direct Write won't be tracked by OS)"
- **Workflow reminder reports check** — Narrowed path matching to only `.claude/data/ai-team-os/reports/` data directories; no longer false-positives on source code files containing "reports"
- **i18n** — Added `allProjects`, `filterType`, `types.*` keys for both English and Chinese

### Fixed
- `app.py` — `_dist_dir` NoneType crash when no dashboard dist directory found
- `test_version_flag` — Updated assertion from `0.8.0` to `1.2.0`
- `test_teamcreate_reminds_task` — Relaxed warning count assertion to `>= 1` (accommodates new active-team warning)
- Report page couldn't switch categories or read reports — Complete rewrite with database backend
- 155 legacy filesystem reports migrated to database via `scripts/migrate_reports.py`

## [1.2.0] — 2026-04-05

### Added
- **Agent Watchdog heartbeat system** — `agent_heartbeat` / `watchdog_check` MCP tools with 5-minute TTL timeout detection, automatic identification of stuck agents
- **SRE error budget model** — GREEN/YELLOW/ORANGE/RED four-level response, 20-task sliding window, `error_budget_status` / `error_budget_update` tools
- **Completion verification protocol** — `verify_completion` checks task status + memo existence, prevents hallucinated completion reports
- **Alembic incremental migration** — Full v1.1 schema migration file (trust_score / channel_messages / entity_id / state_snapshot, etc.)
- **Ecosystem integration recipes documentation** — GitHub / Slack / Linear / full-stack team, 4 preset recipes (`docs/ecosystem-recipes.md`)
- **`ecosystem_recipes()` MCP tool** — Integration recipe discovery and query
- **MCP debug log enhancement** — Startup lock mechanism logging, API startup process now traceable
- **Auto port discovery** — API server automatically finds an available port to avoid multi-project conflicts; port written to `api_port.txt` for sharing
- **MCP HTTP Streamable endpoint** — `/mcp/` mounted on FastAPI (supplementary capability; CC connection remains stdio)
- **INSTALL.md** — CC-assisted installation guide with venv detection logic
- **PyPI 1.2.0 release** — `pip install ai-team-os` fetches the latest version

### Changed
- **Session bootstrap context engineering** — Rules reduced from 23 to 5 core rules (context injection reduced by 60%)
- **Subagent context injection** — Added 60-line cap with priority-based auto-discard of low-priority content
- **`_ensure_api_running` atomic startup lock** — Prevents multi-session port race conditions (`O_CREAT|O_EXCL` file lock)
- **Hooks dynamically read API port** — Port sourced from `api_port.txt` instead of hardcoded 8000
- **`__init__.py` version synced to 1.2.0**
- **`pyproject.toml` metadata** — Added classifiers, keywords, and project URLs

### Fixed
- Alembic integration caused `_run_migrations` to be skipped — changed to always execute (idempotent safe)
- Multiple CC sessions starting API simultaneously caused port conflicts — resolved with atomic file lock
- StateReaper cascade-closing active meetings incorrectly closed meetings with recent messages — added recent message check
- `_read_pid_file` threw `SystemError` on Windows — added catch
- `install.py` uses `sys.executable` absolute path — fixes project venv hijacking hooks/MCP
- `auto_install.py` installs from GitHub — ensures latest code when PyPI version lags
- Startup lock 60-second TTL — prevents stale lock file from blocking startup after CC abnormal exit
- MCP HTTP mount fix — lifespan passthrough + `path='/'` route + 308 redirect handling
- Plugin marketplace 15 install bugs fixed — hooks switched to `${CLAUDE_PLUGIN_ROOT}` paths + restored `.py` scripts

## [1.1.0] — 2026-04-05

### Added
- **Agent trust scoring system** — `trust_score` field (0-1), auto-adjusted on task success/failure, weighted matching in `auto_assign`, `agent_trust_scores` / `agent_trust_update` MCP tools
- **Semantic cache layer** — BM25 + Jaccard similarity matching, JSON persistence, TTL expiration, `cache_stats` / `cache_clear` MCP tools
- **Tool tiering definitions** — CORE (15 essential tools) vs ADVANCED (46 domain tools) classification, preparing for future context budget optimization

### Changed
- Added database index on `TaskModel.status` (query performance improvement)
- `resolve_task_dependencies` uses batch IN query replacing per-row queries (N+1 optimization)
- `detect_dependency_cycle` switched to BFS + batch query (large dependency graph performance optimization)
- `task_list_project` pagination — added `limit` / `offset` / `include_completed` / `status` parameters

### Fixed
- `trust.py` error responses changed to `HTTPException` (previously returned raw dict)
- `git_ops.py` sensitive file filter uses `basename` (avoids false positives when path contains keywords)
- `channels.py` dead code removed
- Pre-existing `test_check_for_updates_no_git_repo_silent` fix

## [1.0.0] — 2026-04-05

### Added
- **Error type to recovery strategy mapping** — `_api_call` uniformly attaches `_recovery` and `_error_category`, auto-recommends recovery actions
- **File lock / workspace isolation** — `file_lock_acquire` / `release` / `check` / `list` 4 MCP tools + TTL=300s + hook warning, prevents concurrent edit conflicts
- **Channel messaging system** — `team:` / `project:` / `global` three channel formats + `@mention` support, `channel_send` / `channel_read` / `channel_mentions` MCP tools
- **Execution pattern memory** — Success/failure pattern recording + BM25 retrieval + subagent context injection, `pattern_record` / `pattern_search` MCP tools
- **Git automation tools** — `git_auto_commit` / `git_create_pr` / `git_status_check` MCP tools with automatic sensitive file filtering
- **Guardrails L1** — 7 dangerous pattern detections + PII warning + `InputGuardrailMiddleware`, prevents destructive operations during unsupervised runs
- **Alembic database migration system** — Initial revision + dual-path init (fresh / existing database), migration history trackable
- **MCP debug logging system** — `~/.claude/data/ai-team-os/mcp-debug.log`, tool call chain observability

### Changed
- **Trap tool elimination** — `team_create` / `agent_register` description first line adds warning + `_warning` return value, prevents misuse
- **`task_id` auto-injection** — Subagent context automatically carries current task_id, no manual passing required
- **Enhanced task assignment** — `auto_assign` adds `completion_rate` + `trust_score` weighting, prioritizes reliable agents
- **`inject_subagent_context` environment variable unification** — Unified to `AITEAM_API_URL`

### Fixed
- `context_monitor` reads project-level monitor file (not outdated global file)
- Pre-existing `test_check_for_updates_no_git_repo_silent` fix

### Tests
- 28 cross-functional integration tests
- Total test count: 769 (up from 389)

## [0.9.0] — 2026-04-04

### Added
- **Prompt Registry** — Agent template version tracking + effectiveness statistics, 3 API endpoints + `prompt_version_list` / `prompt_effectiveness` MCP tools, linked with `failure_alchemy`
- **BM25 search upgrade** — Chinese bigram + English word tokenization replacing simple keyword matching, 3-5x search quality improvement, graceful degradation (`jieba` optional dependency)
- **Event log enhancement** — EventModel adds `entity_id` / `entity_type` / `state_snapshot` fields, automatic snapshot + entity filtering
- **Debate mode** — 4-round structured debate (Advocate -> Critic -> Response -> Judge) + `debate_start` / `debate_code_review` MCP tools + 2 debate role templates
- **3 Dashboard observability pages** — Pipeline visualization / Failure Analysis / Prompt Registry
- **Agent template auto-install** — `install.py` auto-installs to `~/.claude/agents/` (default opus model)
- **CC Marketplace submission** — Officially submitted to Anthropic Plugin Marketplace

### Changed
- **server.py modular split** — 3050-line monolith split into 57-line entry point + 14 tool modules + 2 base modules, significantly improved maintainability
- **Session startup optimization** — 15-25s reduced to 1-2s: parallelization + async git check + reduced retry count
- **workflow_reminder project isolation** — All API calls now include `X-Project-Id` header
- **install.py refactor** — Supports multiple hook groups/events, auto-sets `AGENT_TEAMS` environment variable and `effortLevel` recommended config
- **`_resolve_project_id` caching** — 5-minute TTL file cache, reduces HTTP calls from high-frequency hooks
- **inject_subagent_context environment variable unification** — `AI_TEAM_OS_API` renamed to `AITEAM_API_URL`
- **Test import path migration** — `plugin/hooks/` migrated to `aiteam.hooks` package imports

### Fixed
- workflow_reminder project-level task query missing `X-Project-Id` header (B1)
- TeamDelete PUT request missing `X-Project-Id` header (B2)
- Test file import paths broken (after plugin/hooks deletion)
- `context_monitor` path fix — reads project-level file instead of outdated global file
- statusline.py related deprecated tests cleaned up

### Removed
- **plugin/hooks/ dead code cleanup** — Deleted 11 obsolete `.py` / `.ps1` files, kept only `hooks.json` + `README`
- **Duplicate agent template cleanup** — Deleted old `meeting-facilitator.md` and `tech-lead.md` (25 reduced to 23 templates)
- **enforce_model hook removed** — Preserves user model selection flexibility
- **Model setting removed from install.py** — No longer forces model configuration on new users

## [0.8.0] — 2026-04-04

### Added
- **Cost tracking**: `tokens_input`/`tokens_output`/`cost_usd` on AgentActivity, `GET /api/analytics/token-costs`, `token_costs` MCP tool
- **Execution trace**: `GET /api/tasks/{id}/execution-trace` unified timeline (events + memos), `task_execution_trace` MCP tool
- **Agent live board**: `AgentLivePage` dashboard with status badges (busy/waiting/offline), 30s auto-refresh
- **Failure auto-diagnosis**: `FailureAlchemist.diagnose_failure()`, `POST /api/tasks/{id}/diagnose`, `diagnose_task_failure` MCP tool
- **Slack/webhook notifications**: `NotificationService`, EventBus auto-trigger, `GET/PUT/DELETE /api/settings/webhook`, `send_notification` MCP tool
- **Pipeline parallel execution**: `parallel_with` field, completion gate, 4 new parallel tests (28 total)
- **Execution replay engine**: `ReplayEngine` (get_replay + compare_executions), `task_replay`/`task_compare` MCP tools
- **Cost budget & alerts**: weekly budget limit ($50 default), 80% alert threshold, `GET /api/analytics/budget`, `budget_status` MCP tool
- **Leader Briefing page**: dual-layer tabs (project + status), project name badge, resolve/dismiss UI
- **79 MCP tools** (was 72)

### Fixed
- **P0 API process management**: PID file replaces file lock, `_is_api_healthy()` replaces `_is_port_open()`, stuck process 15s auto-kill
- **Universal project isolation**: `Repository._apply_project_filter()`, `X-Project-Id` header auto-injection from MCP
- **Session bootstrap**: uses cwd-matched project (not `projects[0]`)
- **Briefing list isolation**: uses scoped repository
- **context-monitor**: per-project file isolation (no more cross-session overwrite)

### Changed
- **Hook scripts**: `python -m aiteam.hooks.*` module invocation (no file paths)
- **Plugin hooks.json + .mcp.json**: unified python -m commands
- **install.py**: module-based hooks, `~/.mcp.json` for cross-project MCP

## [0.7.2] — 2026-04-02

### Added
- **MCP tools**: `project_update`, `project_delete`, `project_summary`, `task_subtasks`, `team_delete`, `briefing_dismiss` (72 total)
- **Dashboard project revamp**: status badge (active/inactive), expandable detail rows, wake settings tab
- **Project summary API**: `GET /api/projects/{id}/summary` — quick status + top tasks

### Changed
- **Project isolation redesigned**: removed per-project DB (dead code, -180 lines), unified `context_resolve()` with process-level cache
- **SQLite WAL mode**: enabled via engine event listener for multi-session concurrency
- **Disabled auto project registration**: SessionStart no longer creates projects automatically, prompts user to register via `project_create`
- **context_resolve()**: removed dangerous `projects[0]` fallback, returns None when no match

### Fixed
- Multi-session DB lock: SQLite `journal_mode=WAL` + `busy_timeout=10s` prevents concurrent write failures
- Data backfill: 272 orphan agents, 57 tasks, 72 meetings assigned to correct projects
- Garbage project cleanup: removed 6 auto-created projects, deduplicated quant project
- Dashboard `ProjectSwitcher` dropdown removed (was navigating to blank page)
- Wake agent `--output-format stream-json` error removed (incompatible with `-p` flag)
- Wake circuit breaker: only counts real failures (error/timeout), not skips

## [0.7.1] — 2026-04-02

### Added
- **Leader Briefing system** — decision escalation for autonomous operation
  - DB table `leader_briefings` + Pydantic model + ORM
  - 3 MCP tools: `briefing_add`, `briefing_list`, `briefing_resolve`
  - API endpoints: GET/POST `/api/leader-briefings`, PUT `/{id}/resolve`, PUT `/{id}/dismiss`
  - Leader records pending decisions during autonomous work, user reviews on return
- **Auto-wake via CronCreate** — SessionStart bootstrap injects CronCreate instruction
  - Every 3 minutes, Leader auto-checks task wall and pushes work autonomously
  - Escalates decisions via `briefing_add`, reports pending items when user returns
- **install.py** — one-command setup for hooks, MCP, and verification
  - `python scripts/install.py` — full install (hooks + MCP + settings.json)
  - `python scripts/install.py --check` — verify 9 hooks, MCP, API, package
  - `python scripts/install.py --uninstall` — remove config, preserve data

## [0.7.0] — 2026-04-02

### Added
- **Wake Agent Scheduler** — auto-wake agents via `claude -p` subprocess
  - WakeAgentManager: subprocess lifecycle (communicate + 2-phase kill)
  - WakeSession data model + ORM + 7 repository CRUD methods
  - 7-layer security: array args, UUID validation, per-agent lock, global semaphore (max=2), circuit breaker, prompt/data XML separation, env cleanup
  - Triage pre-check: skip wake if agent has no actionable tasks (~70% skip rate)
  - Kill switch API: `PUT /wake-pause-all`, `PUT /wake-resume-all`
  - StateReaper integration (fire-and-forget + graceful shutdown)
  - allowedTools presets: safe (no Bash) / with_bash (explicit opt-in)
- **CronCreate session wake** — verified CC built-in cron for waking current session
- 20 unit tests for wake_manager (all passing)
- Wake session outcome tracking (completed/timeout/error/fused/skipped_triage)

### Fixed
- `context_resolve()` auto-project selection: match by cwd to root_path instead of blindly picking first project
- Hook path encoding: moved hook scripts to ASCII path (`~/.claude/plugins/ai-team-os/hooks/`)
- Hook exempt list: added claude-code-guide, tdd-guide, refactor-cleaner to non-blocking agent types
- `valid_actions` in scheduler route: added "wake_agent" (was missing, blocked API creation)
- Semaphore private API access (`_value`) replaced with `locked()`
- Circuit breaker: only count real failures (error/timeout), not skips
- `duration_seconds` now correctly calculated and recorded
- `shutdown()` dict iteration safety (snapshot values before cancel)
- Global MCP config: added `cwd` field for cross-directory availability
- Data migration: 19 tasks + 1 team moved from wrong project to correct one

### Changed
- `_clean_env()` switched from whitelist to blacklist strategy (inherit all, exclude secrets)
- Plugin manifest: added `hooks` field pointing to `hooks/hooks.json`
- Plugin `.mcp.json`: local dev mode uses `python -m aiteam.mcp.server` with `cwd`

## [0.6.0] — 2026-03-22

### Added
- Workflow orchestration pipeline (7 templates, auto phase progression)
- Pipeline enforcement: task_type parameter + progressive blocking
- Cross-project messaging system (v1, single machine)
- Auto-update mechanism (scripts/update.py)
- Team cleanup reminder (SessionStart + Rule 15)
- Self-contained install (hooks copied to ~/.claude/hooks/)
- CC Plugin package structure
- Uninstall script (scripts/uninstall.py)
- Dashboard: activity table + decision timeline enhancement

### Fixed
- Global MCP: ~/.claude.json (not settings.json)
- Install dependencies (fastapi, uvicorn, fastmcp now required)
- SessionStart API retry (3 attempts for timing issue)
- B0.9 noise reduction (remind once then every 10 calls)
- Windows UTF-8 encoding in all hook scripts

## [0.5.0] — 2026-03-22

### Added
- Cross-project messaging system (2 MCP tools + 4 API endpoints + global DB)
- Auto-update mechanism (scripts/update.py + install.py --update)
- SessionStart 24h-cooldown update checker
- Self-contained install: hooks copied to ~/.claude/hooks/ai-team-os/
- Global MCP registration in ~/.claude/settings.json

### Changed
- Install reduced to 3 steps (API auto-starts with MCP, no manual startup)

## [0.4.0] — 2026-03-21

### Added
- Per-project database isolation (Phase 1-4)
- EnginePool with LRU cache for multi-DB management
- ProjectContextMiddleware (X-Project-Dir header routing)
- Migration script: split global DB by project_id
- StateReaper + Watchdog multi-DB adaptation
- Dashboard project switcher
- install.py: full onboarding (hooks + agents + MCP + verification)
- GET /api/health endpoint

### Fixed
- Windows UTF-8 encoding in all hook scripts (gbk to utf-8)
- Team templates reference actual agent template names

## [0.3.0] — 2026-03-21

### Added
- Workflow enforcement: Rule 2 task wall check + template reminder
- Local agent blocking (B0.4): all non-readonly agents must have team_name
- Council meeting template (3-round multi-perspective expert review)
- Meeting auto-select: keyword matching across 8 templates
- Meeting cascade close on team shutdown
- find_skill MCP tool with 3-layer progressive loading
- task_update MCP tool + PUT /api/tasks/{id}
- 6 new MCP tools (total: 55)
- 467+ tests

### Fixed
- S1 safety regex catches uppercase -R flag
- S1 heredoc false positive
- Rule 7 task wall timer initialization
- Meeting expiry 2h to 45min
- B0.9 infrastructure tools exempt from delegation counter

## [0.2.0] — 2026-03-20

### Added
- LoopEngine with AWARE cycle
- Task wall with score ranking + kanban
- Scheduler system (periodic tasks)
- React Dashboard (6 pages)
- Meeting system with 7 templates
- 26 agent templates across 7 categories
- Failure alchemy (antibody + vaccine + catalyst)
- What-if analysis
- i18n support (zh/en)
- R&D monitoring system (10 sources)

## [0.1.0] — 2026-03-12

### Added
- MCP server with FastAPI backend
- CC Hooks integration (7 lifecycle events)
- Team/agent/task/project management
- SQLite storage with async repository
- Session bootstrap with behavioral rule injection
- Event bus + decision logging
- Memory search
