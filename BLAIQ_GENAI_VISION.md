# BLAIQ GenAI — Marketing & Brand Studio (Vision)

**Reference:** Higgsfield AI Marketing Studio (researched 2026-06-20). **Differentiator:** Higgsfield extracts a brand *per product URL, per session*; BLAIQ has **persistent Brand DNA + Brand Tone per tenant** — agency-grade, reused across every asset, every client, every campaign. Every BLAIQ generation is on-brand *by construction*.

This is the target feature set for BLAIQ GenAI. **Every generation — images, video, pitch text, social artifacts (Instagram/LinkedIn/reports), decks — runs on the same three context layers:**

## Context architecture (the core principle)
Every BLAIQ GenAI output is grounded by **three layers**, injected before generation:
1. **Brand DNA** — visual identity (palette, typography, iconography, texture). → on-brand visuals.
2. **Brand Tone** — voice, vocabulary, archetype, grammar. → on-brand copy.
3. **Hivemind recall** — the company brain (`hivemind_recall` MCP, daemon-side preflight) pulls the *right company/product/campaign facts* for the specific request and injects them as context.

DNA + Tone + Hivemind = the context for **every** modality, not just text. (Status: prompt-augment injects all three; Hivemind recall was text/question-only and is now extended to visual builds too — image/video/deck. The ops-brain deck engine still needs the Hivemind layer wired — follow-up.)

## What Higgsfield Marketing Studio does (the bar)
- **URL → assets**: paste a product/app URL → auto-extract product name, description, images, brand colours.
- **3 production styles**: UGC · CGI · Cinematic, switchable in one workspace.
- **10+ ad formats**: talking-head, product review, tutorial, unboxing, virtual try-on (UGC); hyper-motion/pure-CGI, pro try-on, product demo (CGI); TV spot, Wild Card "AI directs" (cinematic).
- **Avatars**: 40+ presets + custom text-to-avatar (Soul 2.0); pin/rename/**reuse across campaigns** (spokesperson consistency).
- **Variant/batch**: dozens of variants across formats × avatars × directions from one URL → A/B tests, channel-specific, localized.
- **Reference-based**: upload a viral ad → AI analyses structure → "same format, your brand, your face".
- **Hook optimization**: proven 3-second openers; builds the ad around the hook.
- **Engine**: Seedance 2.0 video (lip-sync, physics, character consistency). **Team**: shared projects, roles.
- **Apps**: Click-to-Ad, Billboard Ad, Truck Ad, Bullet-Time product rotation, Headshot, Outfit/Character Swap, Relight, Background Remover, Angles/Shots (multi-camera from one image), Expand Image.

## BLAIQ GenAI — visioned features (brand-driven)

### ✅✅ FULL MissionBuilder agent flow LIVE at full scale (2026-06-20)
The GenAI agent path now runs **server-side via OpenRouter, no per-browser BYOK, no direct Anthropic key**. The bundled Claude Code CLI is routed to OpenRouter's Anthropic-compatible endpoint:
- `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<OpenRouter key>`, `ANTHROPIC_MODEL=anthropic/claude-sonnet-4.6`, `ANTHROPIC_SMALL_FAST_MODEL=anthropic/claude-haiku-4.5`, `DISABLE_INTERLEAVED_THINKING=1`, `MAX_THINKING_TOKENS=0` (thinking off — OpenRouter's compat doesn't surface thinking tokens, which had returned empty results).
- Daemon fixes: the tenant sandbox now forwards these vars (`sandboxed-spawn.ts`), and the claude adapter no longer forces its built-in `claude-opus-4-8[1m]` slug when a custom base URL is set, letting the OpenRouter model govern (`claude.ts`).

**Proven end-to-end in the real app**: a plain German query in a mission ("Schreibe einen LinkedIn-Post über unsere KI-Markenplattform") → the daemon auto-applied Brand DNA + Tone (+Hivemind) → the agent generated an on-brand B&B post via `claude-sonnet-4.6` ("Mensch × Maschine = Marke … Sinn für Marken. Jetzt mit Maschine. #BBMarkenagentur") in 6s. **No brand info was typed by the user** — exactly the intended flow.

### ✅ Verified in the REAL MissionBuilder flow (2026-06-20)
The canonical GenAI UI is **BlaiqShell + MissionBuilder** (5-step wizard: TYPE · NAME · BRAND · CONFIG · LAUNCH → `createProject` → agent → TextArtifact/Image/Video panels). Logged into the real app (session minted for the B&B tenant) and confirmed: a `deck` mission's generation injects, via `prompt-augment`, the **real B&B Brand DNA + Brand Tone + Visual Brand Lock** (dark #0A0A0A, orange #FF6008, Univers Next, signature dot, "Sinn für Marken"). Refinement shipped: the **deck-framework now binds the Brand DNA palette/typography to the deck `:root` with precedence** over design-system defaults — so pitch decks render on-brand, not on the generic placeholder theme. (Running a generation through the UI itself additionally needs an execution mode — Local CLI or BYOK key — configured for the user.)

### A. Brand Studio (foundation)
- Brand DNA + Brand Tone editor ✅ (exists). **Compile DNA → machine-readable tokens** (palette hex, typography, iconography, voice pillars, vocabulary) cached per tenant; injected into *every* modality. Visual Brand Lock ✅ shipped (prompt-level); next: structured token compile.

### B. Brand & Asset Intake
- Extend intake: **paste a product/campaign URL or brief** → auto-extract product, images, and (cross-check) brand colours against Brand DNA → a reusable **brand/product profile**. (BLAIQ intake already drafts jobs from inquiry text — extend to products/URLs + asset pull.)

### C. Modality engines (precise, clean, on-brand)
- **Text/Copy** ✅ — brand-tone-aware (ads, captions, scripts, proposals).
- **Social artifacts** ✅ — `POST /api/copilot/social`: Instagram/LinkedIn/X/Facebook/report copy + hashtags, brand-toned, with a **one-click prefilled "Post to {platform}"** composer link (real API auto-post = future OAuth, per platform). In the GenAI Studio tab.
- **Decks** ✅ v1 — brand-locked HTML deck generation (engine live). Next: more layouts, export, deck templates library.
- **Images** 🔜 — brand-locked product/marketing images: product shots, billboard/OOH, bullet-time rotation, try-on, lifestyle. Multi-angle/"Shots", relight, background-remove, expand. (19 providers wired.)
- **Video** 🔜 — UGC / CGI / cinematic / TV-spot via the existing 7-stage pipeline + Higgsfield/Seedance (key already in `tenant_brand`). Brand DNA into the script + visual direction; HITL gate before the expensive render.

### D. Ad-format & template library
- Curated, brand-locked templates per style (UGC talking-head/unboxing/try-on; CGI hyper-motion/product demo; cinematic TV-spot) — pick a format, get an on-brand asset.

### E. Spokesperson / avatar consistency
- Brand spokespersons: create + pin + reuse across campaigns for a consistent face/voice (maps to Higgsfield avatars; BLAIQ ties them to the brand).

### F. Variant & batch generation
- One brief → many on-brand variants across formats/channels/locales for A/B testing — the agency's volume play.

### G. Reference-based creation
- "Make me an ad like *this* one, in our brand" — analyse a reference's structure, regenerate brand-locked.

### H. Hook / opener optimization
- Proven opener patterns; brand-tone hooks; (later) virality scoring.

### I. Convergence with Administration (Track C)
- Generate campaign deliverables **tied to a Job** (the deck/images/video for job 2026-0xx), delivered via the Server track, billed via POOOL. The agency's creative output and its operations become one loop.

## Current state → priority
1. **Decks** — engine ✅, add UI + templates + export. *(needs a studio login to wire UI)*
2. **Brand-token compile** — structured tokens from DNA (free, verifiable). **Next safe build.**
3. **Images** — brand-locked product/marketing images. *(needs image-provider creds + OK to spend)*
4. **Video** — wire Higgsfield/Seedance + brand into the 7-stage pipeline + HITL. *(needs provider creds + spend OK)*
5. **Intake → product/URL profiles**, ad-format library, variants, avatars, reference-based — layer on top.

**Blockers to verify the paid modalities (images/video):** provider credentials + explicit OK to spend real generation credits. **To wire any studio UI:** a login (the creative studio is auth-gated; seed creds are empty).
