# Matching Higgsfield Marketing Studio — Vision & Gap Plan

Screenshots captured 2026-06-20 (this folder): `home.png`, `marketing-studio-intro.png`, `marketing-automation.png`, `product-ad-generator.png`, `app-ad-generator.png`, `apps.png`, `pricing.png`.

## Higgsfield's pitch (what to match)
**"From link to live ad in minutes."** Paste a product/app URL → AI extracts product + brand → pick a mode + avatar → generate publish-ready ads. Their pillars:
1. **URL → assets** — auto-extract product images, copy, and brand colours from a link.
2. **3 production modes** — UGC · CGI · Cinematic.
3. **10+ ad-format templates** — talking-head, unboxing, review, tutorial, virtual try-on, hyper-motion (CGI), TV spot, "Wild Card".
4. **Avatars** — 40+ presets + custom text-to-avatar (Soul 2.0), pinned + reused across campaigns.
5. **Batch / variants** — dozens of variants across formats × avatars × directions from one URL (A/B, channel, locale).
6. **Reference-based** — upload a viral ad → "same format, your brand, your face".
7. **Hooks** — proven 3-second openers + a Virality Predictor.
8. **Engine** — Seedance 2.0 video (lip-sync, physics, character consistency).
9. **Apps** — Billboard/Truck Ad, Bullet-Time product, Headshot, Relight, Outfit/Character/Face Swap, Angles/Shots (multi-cam from one image), Expand Image.
10. **One prompt → entire campaign**; team workspaces; tiered pricing.

## BLAIQ's edge (already ahead)
| Capability | Higgsfield | BLAIQ |
|---|---|---|
| Brand context | per-URL extraction, per session | **persistent Brand DNA + Tone + Hivemind per tenant** → on-brand *by construction* |
| Modalities | image, video, avatars | text · **decks** · image · video — all live, HITL-gated |
| Ops integration | none | tied to **POOOL finance + Admin jobs** (Track C convergence) |
| Provider lock-in | their stack | provider-agnostic via OpenRouter (no vendor lock) |

## Parity table — where we stand vs. what to build
| Higgsfield feature | BLAIQ today | Gap → action |
|---|---|---|
| URL → product+brand assets | intake = inquiry→job (text) | **Extend intake to a product/campaign URL**: scrape product imgs/copy, cross-check colours vs Brand DNA → reusable product profile |
| 3 modes (UGC/CGI/cinematic) | video styles exist (cinematic) | Add **mode presets** to MissionBuilder (UGC / CGI / cinematic) feeding the video + image prompts |
| 10+ ad-format templates | deck/templates exist; no ad-format library | Curate a **brand-locked ad-format template library** (talking-head, unboxing, try-on, TV-spot, hyper-motion) |
| Avatars / spokespeople | none | **Brand spokesperson** entity: generate + pin + reuse a consistent face/voice across campaigns |
| Batch / variants | one asset per run | **Variant engine**: one brief → N on-brand variants across formats/channels/locales (the agency volume play) |
| Reference-based ("ad like this") | none | "**Make an ad like this, in our brand**": analyse a reference's structure → regenerate brand-locked |
| Hook optimization | brand-tone hooks in copy | Add **proven-opener presets** + (later) a virality/score pass |
| Video engine | OpenRouter/Seedance i2v ✅ | already comparable; wire **Higgsfield/Seedance** key (in `tenant_brand`) for premium |
| Apps (billboard, bullet-time, swap, relight, multi-angle, expand) | image gen ✅ | Ship as **brand-locked image presets** (billboard/OOH, product bullet-time, relight, multi-angle, expand) |
| One prompt → full campaign | per-modality missions | **Campaign orchestrator**: one brief → deck + images + video + social set, all on-brand, in one run |
| Pricing / plans | n/a (agency-internal) | not needed (single agency); optionally per-client cost rollups |

## Recommended build order (closing the gap)
1. ✅ **Campaign orchestrator — SHIPPED** (`POST /api/copilot/campaign`, Studio "✦ Campaign"). One brief → concept (headline + big idea + key message + channels) + a brand-locked 5-slide deck + multi-platform social (with one-click post links) + image & video briefs. Verified live: "Launch our AI brand platform" → "Mensch × Maschine. Endlich eine Marke." with the dot motif, all on-brand. This is the "one prompt → campaign" headline.
2. **Ad-format + mode presets** (UGC/CGI/cinematic × template library) — turns freeform missions into pick-a-format speed.
3. **URL/product intake** → product profile (matches "from link to ad").
4. **Variant engine** — N brand variants per brief for A/B + channels.
5. **Brand spokespersons** (avatars) + **reference-based** generation.
6. **Image-preset apps** (billboard, bullet-time, relight, multi-angle, expand) — fast wins on top of the working image pipeline.
7. **Hooks + virality scoring**; premium Higgsfield/Seedance video.

## The one-line vision match
Higgsfield = "paste a link, get an ad." **BLAIQ = "describe it once, get an on-brand campaign"** — because the brand (DNA + Tone + Hivemind) is already loaded, every asset across text/deck/image/video is on-brand by construction, and it's wired to the agency's real jobs + finance. Matching their vision = adding the **campaign orchestrator + format/mode presets + URL intake + variants** on top of the four modalities that already run at full scale.
