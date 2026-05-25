---
name: video-promo
description: |
  Multi-stage cinematic brand promo video (30-90s) with presenter, voiceover,
  brand-consistent shot library, and music. Built via daemon pipeline:
  script → reference frames → i2v shots → voice → stitch.
triggers:
  - "promo video"
  - "brand video"
  - "presenter video"
  - "hero video"
  - "launch video"
od:
  mode: video
  category: video-promo
  preview:
    type: video
    file: final.mp4
---

# video-promo — Brand Humanized Promo Video

Daemon-orchestrated pipeline produces 30-90s 1080p MP4. You do NOT call
image/video APIs directly — call `POST /api/v1/video/render` with the
mission brief and the daemon runs all 7 stages.

## Pipeline stages (daemon-driven, no work for you)

1. Skill router (LLM picks this skill)
2. Hivemind recall (brand + product + people facts)
3. Script + storyboard (LLM, JSON with shots, narration, music brief)
4. Reference image gen per shot (image API, seed-locked for consistency)
5. Voiceover gen (ElevenLabs / OpenAI TTS)
6. Video gen per shot (i2v model with ref frame + motion prompt)
7. FFmpeg stitch + voice mix + music + color grade → `final.mp4`

## Storyboard JSON contract (Stage 3 output)

```json
{
  "title": "SolvisLea Pro Launch",
  "duration_s": 60,
  "narration": "full voiceover script in brand voice",
  "music_brief": "warm ambient, slow build, no vocals",
  "color_grade": "warm amber, golden hour, Solvis palette",
  "shots": [
    {
      "shot": 1,
      "duration_s": 4,
      "visual": "wide establishing shot of sun-lit family kitchen",
      "image_prompt": "cinematic photo, warm amber, family kitchen morning light",
      "presenter_action": "smiles, gestures",
      "narration_chunk": "Wärme, die mitdenkt..."
    }
  ]
}
```

## Inputs from mission brief

- subject (what the video is about)
- style (cinematic / documentary / product-shot / editorial)
- voiceover (yes/no)
- music (yes/no)
- aspect (16:9 / 9:16)
- length (30-90s)

## Output

`final.mp4` (H.264, 10 Mbps, 1080p) saved to project dir + intermediate
storyboard.json, ref frames per shot, individual shot clips.
