# Stack & Balance — desktop integration

Stack & Balance is a single-player Three.js/Rapier stability challenge with ten
seeded block sequences. The deterministic stack model owns placement support,
height, dwell, the one-shot nudge and result state. A per-window Three renderer
and Rapier collision world provide the bench presentation; decorative physics
never changes model-space geometry or support predicates.

The app exposes synchronous `mount(host)` and disposes its renderer, Rapier
world, meshes, observers, pointer/keyboard listeners, audio and account-file
subscription idempotently. Desktop pointer/keyboard and phone button controls
move, rotate and release each block. Practice halves model time only.

Save and Open use the signed-in desktop's **My files** through
`host.storage.mirrorFileContext()`. Saves contain the validated challenge,
ordered placed blocks, active placement and rotation, dwell/nudge counters,
practice rule and RNG state. Loading restores paused and directly accepts a
Files launch path without showing another picker.

Save and Open serialize file operations. Saving captures the logical snapshot
and destination before asynchronous storage work, marks the desktop window
dirty while the write is pending, and keeps later edits unsaved. Opening
validates a replacement before committing it and rejects changes made during a
confirmation or delayed read. Cancelled or failed operations keep the current
tower and its saved-file watch. Desktop-window focus loss, workspace changes,
minimizing, roll-up, browser blur and browser visibility changes pause the run
until Run is selected.

## Current limitation

No authored `balance-meter.riv` is supplied. The stability instrument is an
explicit procedural placeholder, so the Rive acceptance gate remains open.
The desktop preview does not implement the entered-XR lifecycle or world-space
controls. Galaxy XR, physical-phone and performance/thermal testing remain
open.

Engine versions are pinned in `package-lock.json`: Three.js `0.187.0` and Rapier
`0.21.0`.

## Verification

```sh
npm run typecheck --prefix apps/games/02-three-physics-xr/stack-balance
npm test --prefix apps/games/02-three-physics-xr/stack-balance
CODI_STACK_MANIFEST=.build/stack-balance/apps.json \
CODI_STACK_URL=http://127.0.0.1:18345/ \
node tests/stack-balance-browser.test.mjs
CODI_PHONE=1 ... node tests/stack-balance-browser.test.mjs
node tests/stack-balance-safety.test.mjs
node tests/stack-balance-account.test.mjs
```

Desktop and 412×915 fixture checks cover the complete block sequence,
dwell/nudge outcome, focus-loss pause, save/reopen, malformed-file recovery
and idempotent disposal. The delayed-save test checks pending close protection
and captured destination behavior. The isolated account test verifies server
sync, Files routing, paused phone-sized reopen and account isolation.

The isolated `tests/stack-balance-gesture-review.test.mjs` verifies that a
cancelled emulated touch does not drop a block, a completed touch does, and
keyboard auto-repeat does not release additional blocks. It also saves, syncs
and reopens the tower. Physical-device gesture cancellation remains untested.
