> Original design reference from 2026-10-30. This describes intended behavior, not current implementation or qualification. The current app README is authoritative for status. Pseudocode and template JSON here are documentation, not build entries.

# Stack & Balance

**Stability challenge · Three.js + Rapier · single-player · phone required · immersive XR required**

> Planned design, not implemented or browser-tested. `index.pseudo.mjs` is an explanatory entry point, not a playable game.

## Experience

Build a tower from awkward blocks and keep it stable while the table gives a small, announced nudge.

## What this demonstrates

- Contact stability and friction
- Bounded impulse events
- Measured objectives rather than visual guesses

## Rules and complete loop

- Place a prescribed block sequence; release each block before selecting another.
- Success requires all target blocks supported above the line for a fixed dwell interval and surviving one bounded nudge.
- Only toy objects are simulated. Slow-motion practice is a named rule setting, not display-dependent physics.

## Bounded polished release

Ten challenges with increasing shape variety, height targets and two difficulty settings.

- Show center-of-mass projection as an optional teaching overlay
- Audible/visual nudge countdown
- Gentle failures with one-tap retry

No multiplayer, accounts, server simulation or generic editor is required. Start, rules/help, play/activity, pause, outcome/goal feedback and retry must all be complete. Settings include volume/mute, reduced motion, contrast and game-specific options where meaningful. State changes occur in the game model; animations illustrate them.

## Rive inside this app

Stability instrument and announcer on the bench, not an authoritative physics solver. The requested asset is `balance-meter.riv`; it is **not included**. See [RIVE.md](RIVE.md) for the authoring/integration contract. A placeholder or unrelated animated logo does not satisfy this requirement.

## Save behavior

Same-build world snapshot plus sequence, dwell, nudge and progress counters. See [SAVE.md](SAVE.md). Loading starts paused; resume is explicit. Entering/exiting XR preserves the live current state even when exported saves are checkpoints.

## Build sequence

Implement the rule loop in [gameplay.pseudo.txt](gameplay.pseudo.txt); bind the exact app lifecycle from [index.pseudo.mjs](index.pseudo.mjs); complete [CONTROLS.md](CONTROLS.md); author/integrate [RIVE.md](RIVE.md); then satisfy [ACCEPTANCE.md](ACCEPTANCE.md). The full XR flow and game-specific presentation are in [XR.md](XR.md).

Target wave: **2**. Integrator first reads [AGENTS.md](../../../../../docs/games/design-reference/ORIGINAL-INSTRUCTIONS.md); do not guess host APIs from symbolic helper names.

Use original/licensed artwork and audio. Keep the scope small enough to polish; expand content only after the release gates pass.
