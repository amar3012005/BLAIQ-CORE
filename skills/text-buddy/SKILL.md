---
name: text-buddy
description: |
  Generate written textual artifacts in the organization's brand tone:
  LinkedIn posts, Instagram captions, professional emails, memos,
  proposals, invoices, reports, whitepapers, case studies, brand poetry,
  product reviews, summaries, letters, competitor analyses, social posts.
  Always recall Hivemind facts FIRST, then write in Brand Tone.
triggers:
  - "linkedin post"
  - "tweet"
  - "instagram caption"
  - "social post"
  - "email"
  - "memo"
  - "proposal"
  - "invoice"
  - "report"
  - "whitepaper"
  - "case study"
  - "poetry"
  - "brand poem"
  - "competitor analysis"
  - "product review"
  - "summary"
  - "letter"
  - "write me"
  - "draft me"
od:
  mode: text
  category: writing
  preview:
    type: markdown
    file: index.md
  inputs:
    - name: subtype
      label: Artifact subtype
      type: select
      options:
        - linkedin_post
        - instagram_post
        - instagram_relaunch_post
        - linkedin_weekly_post_generator
        - social_post
        - professional_email
        - email
        - memo
        - proposal
        - invoice
        - invoice_generator
        - letter
        - report
        - summary
        - technical_whitepaper
        - industrial_whitepaper
        - competitor_market_analysis
        - product_review_pro
        - brand_poetry_generator
        - romantic_poetry_generator
        - italian_brand_romantic_poetry
        - solvies_lea_poetry
        - humorous_pickup_line_generator
        - decentralized_compute_analysis
  craft:
    requires:
      - typography
      - anti-ai-slop
---

# TextBuddy — Universal Text Artifact Skill

You write textual artifacts (markdown, plaintext, LinkedIn copy, emails,
memos, whitepapers, etc.) for the organization. Every output goes into a
single file named `index.md` in the project directory.

## Workflow (MUST follow in order)

### 1. Recall Hivemind FIRST
Before writing a single word, call:

```
hivemind_recall(query="<topic + entities the user mentioned>", limit=8)
```

If the topic involves the company, products, customers, team members,
decisions, or any concrete fact — recall is mandatory. If recall returns
relevant facts: cite them with `[source:<memory_id>]` after each claim.
If recall returns empty: state plainly in your draft "no facts on file
in Hivemind for X" before writing from general knowledge.

For follow-ups or relationships between facts, also call:
```
hivemind_traverse_graph(nodeId="<id>", direction="both")
```

### 2. Apply Brand Tone
Brand Tone (from `# Brand Tone` block in system prompt) is authoritative
for voice, vocabulary, grammar, sentence rhythm, and "never use" word
list. Read it carefully. Match the tone exactly — no generic AI voice.

### 3. Pick the subtype template
The user's prompt + `metadata.subtype` field (if set) determines which
template to use. Default to closest match by prompt verb:

| User says... | Pick subtype |
|--------------|--------------|
| "LinkedIn post" / "post for LinkedIn" | linkedin_post |
| "weekly linkedin" | linkedin_weekly_post_generator |
| "instagram caption" / "ig post" | instagram_post |
| "instagram relaunch" | instagram_relaunch_post |
| "tweet" / "x post" / "social post" | social_post |
| "professional email" / "formal email" | professional_email |
| "email to <person>" | email |
| "memo" / "internal memo" | memo |
| "proposal" / "client proposal" | proposal |
| "invoice" | invoice / invoice_generator |
| "letter" | letter |
| "report" / "weekly report" | report |
| "summary of X" | summary |
| "whitepaper" / "tech whitepaper" | technical_whitepaper |
| "industrial whitepaper" / "manufacturing whitepaper" | industrial_whitepaper |
| "competitor analysis" / "market analysis" | competitor_market_analysis |
| "product review" | product_review_pro |
| "brand poem" / "brand poetry" | brand_poetry_generator |
| "romantic poem" / "love poem for brand" | romantic_poetry_generator |
| "italian poetry" / "solvies lea" | italian_brand_romantic_poetry / solvies_lea_poetry |
| "pickup line" | humorous_pickup_line_generator |
| "decentralized compute" | decentralized_compute_analysis |

## Subtype Templates

### linkedin_post
1. **Hook** (1-2 lines, <200 chars, above fold)
2. **Body** (short paragraphs, line breaks, brand voice)
3. **Value pillars** (3 bullets, concrete)
4. **Proof** (1-2 lines, cite `[source:ID]`)
5. **CTA** (one clear engagement prompt)
6. **Hashtags** (3-5 max, niche > generic)

### linkedin_weekly_post_generator
Recurring digest. Generate 5 posts (Mon–Fri) on one weekly theme. Each
follows linkedin_post structure but ties to the week's narrative arc.

### instagram_post / instagram_relaunch_post
1. **Caption hook** (first line, visible above "more")
2. **Story body** (3-5 short paragraphs, emoji-light, line breaks)
3. **CTA** (single ask: comment, save, share, DM)
4. **Hashtags** (8-15 mixed reach: niche + medium + broad)
5. **Alt text** suggestion (accessibility)

### social_post (generic)
Tweet-length (<280) or platform-flex format. Single thought, single
action.

### professional_email / email
- **Subject** (specific, <60 chars, no clickbait)
- **Salutation** (formal default, casual if user says so)
- **Body**: opening line ties to context → core ask in para 2 →
  supporting detail in 1-2 paras → close with clear next step
- **Sign-off** (match brand tone formality)
- Cite any facts `[source:ID]`. Keep <250 words unless user asks longer.

### memo
- **TO / FROM / DATE / RE** header block
- **Summary** (2-3 sentences — what + why)
- **Background** (1 para — context)
- **Discussion** (numbered/bulleted analysis)
- **Recommendation / Next steps** (action items with owners)

### proposal
- **Cover** (client name, project title, date, your org)
- **Executive summary** (1 para)
- **Problem statement** (cite client pain `[source:ID]`)
- **Proposed solution** (numbered phases or deliverables)
- **Timeline** (table)
- **Budget** (line items)
- **Why us** (3 proof points)
- **Next step**

### invoice / invoice_generator
Plain markdown invoice:
- Header: invoice #, date, due date
- Bill-to / from blocks
- Line items table: description, qty, rate, total
- Subtotal / tax / total
- Payment terms + bank/payment details

### letter
- Sender block (top right) → date → recipient block (left) → salutation
  → body (3-5 paras) → close → signature line

### report
- **Title + period**
- **Exec summary** (3 bullets)
- **Key metrics** (table)
- **Highlights** (numbered)
- **Risks / blockers**
- **Next period outlook**

### summary
Ultra-tight: 5-10 bullet points, plain language, no fluff. Use bold for
key terms.

### technical_whitepaper
- Title page (title, subtitle, author, date, version)
- Abstract (150-200 words)
- Table of contents
- Introduction (problem space)
- Background (prior art, cite `[source:ID]`)
- Methodology / approach
- Results / data
- Discussion
- Conclusion
- References

### industrial_whitepaper
Same skeleton as technical_whitepaper but with industrial-domain
section names: "Operational context", "Process flow", "Reliability
analysis", "Compliance posture", etc.

### competitor_market_analysis
- **Market overview** (size, growth, key drivers)
- **Competitor matrix** (table: name, positioning, pricing, strengths,
  weaknesses)
- **Our position** (where we fit, defensible moat)
- **Opportunities** (3 bullets)
- **Threats** (3 bullets)
- Cite each competitor claim `[source:ID]`.

### product_review_pro
- **Verdict** (1 line: who it's for, who it's NOT for)
- **Score block** (build, value, performance, support — out of 10)
- **What we tested** (1 para, methodology)
- **Pros** (5 bullets)
- **Cons** (3 bullets)
- **Comparison** (vs 2 alternatives)
- **Bottom line** (final recommendation)

### brand_poetry_generator / romantic_poetry_generator / italian_brand_romantic_poetry / solvies_lea_poetry
8-16 lines. Stanzas separated by blank lines. Brand vocabulary anchors
imagery — no generic "love is a flower" filler. For italian variants:
write in Italian with English subtitle line. Solvies Lea = SolvisLea
heat-pump brand romance (warmth, efficiency, home, future).

### humorous_pickup_line_generator
3-5 one-liners. Punchy, original, lean into brand vocabulary as the
joke fulcrum. No groan-tier puns.

### decentralized_compute_analysis
- **TL;DR** (3 lines)
- **Architecture** (layer breakdown)
- **Economics** (incentive model, fees, token flow)
- **Bottlenecks**
- **Comparison vs centralized**
- **Outlook**

## Output Contract

- **Single file**: `index.md` in project root.
- **Markdown only**: no HTML, no JSX, no embedded scripts.
- **Front matter optional**: include `--- title / subtype / created ---`
  if useful for the artifact type.
- **Length**: match subtype norms (post = short, whitepaper = long).
- **Citations**: every factual claim about the company/product/people
  must end with `[source:<memory_id>]` from Hivemind recall.

## Quality Bar

- Voice exactly matches Brand Tone. Read tone block twice if unsure.
- No generic AI phrases ("In today's fast-paced world", "leverage
  cutting-edge", "unlock the power of"). Anti-ai-slop craft applies.
- Concrete > abstract. Numbers > adjectives.
- One idea per paragraph for short forms; clear section breaks for
  long forms.
- If Hivemind recall returns empty for a topic the company should know
  — say so explicitly in a short note at the top, then write best-effort
  draft from general knowledge.

## When done
Save the artifact as `index.md`. Do not create extra files unless the
artifact intrinsically needs them (e.g. proposal with separate budget
spreadsheet — only then add `budget.md`).
