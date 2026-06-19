# Track AA — Agentic Administration

**The AI layer that turns the (now feature-complete) Administration workflow into an AI-operated agency desk.** Track A gave us the data + actions (jobs, finance, tasks, folders, notifications). Track AA puts an **agent** on top that can *understand* the agency's state and *act* on it in natural language, with the human as director.

> Built on the existing stack — no AgentScope needed. ops-brain already has LangChain/LangGraph; the copilot runs on a dependency-light **OpenRouter (httpx) client** since prod's only LLM credential is the OpenRouter key. Default model `anthropic/claude-sonnet-4.6` (configurable via `BLAIQ_COPILOT_MODEL`).

---

## Vision — what the PM experiences

A new **Copilot** surface in the admin. The PM talks to the agency:

- *"Which jobs are overdue and how much is outstanding?"* → instant grounded answer from live job data.
- *"Summarise this week across all jobs."* → status digest.
- *"Draft a payment reminder for the Voss invoice."* → proposes the message.
- *"Create a job for Café Mehlwald, rebrand, quote €6,200."* → proposes the action → **PM approves** → it runs (creates the job, the folder, etc.).
- *"What should I do next?"* → the agent triages: overdue chases, undelivered jobs, stale quotes.

The agent is **grounded** in the tenant's real jobs/finance/notifications and uses the **Track A actions as tools**. Every state-changing action is gated by a **Human-in-the-loop (HITL)** confirmation until trust is earned.

---

## Phases (vision → recon → build → deploy → verify, one at a time)

| Phase | Feature | What ships |
|------|---------|-----------|
| **AA1** `[building]` | **Admin Copilot (read-only)** | A chat panel + `POST /api/admin/copilot`. The agent is grounded in live jobs + a computed finance summary and answers questions (overdue, margins, status, "what's at risk"). No mutations yet — safe, instant value. |
| **AA2** `[ ]` | **Agentic actions (HITL)** | Give the copilot tools mapped to Track A actions (create job, set status, push POOOL/ClickUp, mark delivered, create folder, draft+send reminder). The agent *proposes* a tool call; the PM approves in-panel; then it executes. |
| **AA3** `[ ]` | **The Supervisor** | An always-on agent that watches jobs/notifications and surfaces a prioritised "next actions" queue (chase these overdue, deliver these, follow up these quotes) — proposals the PM one-click approves. Built on the existing loop/scheduler. |
| **AA4** `[ ]` | **Insight agent + digests** | Scheduled natural-language digests (daily/weekly) into the notifications feed: cash at risk, throughput, revision load, margin trends. |
| **AA5** `[ ]` | **Multi-agent crew** | Specialist roles (Finance, Delivery, Collections) via the LangGraph TeamManager, coordinated by a leader — for complex asks that span tracks. AgentScope evaluated here if the LangGraph crew proves limiting. |

## FE robustness (parallel, ongoing)
The admin FE gets hardened alongside: a shared design-token pass, a reusable chat/stream component, optimistic updates + toasts, keyboard access, and an AI-first information layout (the Copilot as a first-class surface, not a bolt-on).

## Cross-cutting
- **Grounding over hallucination:** the agent only answers from injected live data + tool results; it cites job numbers.
- **HITL by default:** mutations require explicit approval until the PM raises the trust level.
- **Tenant isolation + cost cap:** every agent call is tenant-scoped (RLS) and counts against the per-tenant daily LLM cost cap.
- **Graceful + observable:** agent runs and tool calls are logged; failures degrade to a clear message.

---

*End state: the PM runs the agency by conversation — the agent reads the whole board, proposes the next moves, and (once trusted) executes them across POOOL/ClickUp/Server, while every action stays auditable. This is the Administration half of "an agency running on AI"; Track B (GenAI) is the creative half.*
