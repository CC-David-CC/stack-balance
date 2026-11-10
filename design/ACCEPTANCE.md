> Original design reference from 2026-10-30. This describes intended behavior, not current implementation or qualification. The current app README is authoritative for status. Pseudocode and template JSON here are documentation, not build entries.

# Acceptance — Stack & Balance

**All runtime cases are NOT RUN.** This file is a plan; document checks are not gameplay evidence.

Apply all C01–C24 in [common acceptance](../../../../../docs/games/design-reference/ACCEPTANCE-COMMON.md). Also apply X01–X16 on the actual Galaxy XR.

## Game-specific cases

| ID | Experiment / invariant | Status |
|---|---|---|
| stack-balance-G01 | Dwell counts only when objective predicates hold continuously. | not_run |
| stack-balance-G02 | Nudge occurs once and uses model coordinates. | not_run |
| stack-balance-G03 | Dropped input cannot leave a block attached forever. | not_run |
| stack-balance-G04 | Measure height from colliders, not decorative Rive art. | not_run |
| stack-balance-G05 | Save before nudge restores its timer. | not_run |
| stack-balance-G06 | AR placement changes neither mass nor support predicates. | not_run |

## Release evidence

Record rules/content and dependency versions, actual asset names/hashes, desktop browser, real phone and (where required) Galaxy XR build, commands/logs, complete-playthrough result, save restoration result, multiwindow/late-disposal behavior, frame timing and unresolved defects. Exercise actual Rive properties and texture input rather than substituting an HTML mock.

A pure rules unit test, a visual smoke test and a hardware XR test are different evidence. Preserve that distinction. All promised features must be demonstrated or explicitly left incomplete; do not relabel a generic engine scene as the finished game.
