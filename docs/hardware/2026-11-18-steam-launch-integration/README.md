# Combined WoW launch on Steam Deck

DEVICE 2026-11-18. The deck-test runner deployed merge
`2d0960e1872424a218ddf07bcf0b40ee6863450c` on `feat/257-wow-launch`,
including the engine change, and reloaded WoWDeck 1.2.1. The installed
files matched the deployment artifacts.

| Installed file | SHA-256 |
| --- | --- |
| `dist/index.js` | `847b19b5ae21cf91716ddb27d105908c847485a44936e82472066e58c1276d76` |
| `main.py` | `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7` |
| `bin/wowdeck-x86_64` | `e13ae8acffdecff7913ac1e8c3124b5307a5eb80f7cb3c8d52fb8339ea514444` |

The run reused the existing World of Warcraft shortcut (app ID
`4221385996`) and Forever client. The shortcut reaper used
GE-Proton11-12-x86_64 with SteamLinuxRuntime_4. The runner installed no
game or compatibility tool. The SSH observer matched the shortcut's
prefix and paused only its existing retry wrapper after the reaper
appeared. It held the wrapper until it saw the Forever executable or
the observation window expired. See the earlier
[delivery](../2026-11-18-steam-launch-delivery/README.md),
[started-entry](../2026-11-18-steam-started-entry/README.md) and
[stopped-entry](../2026-11-18-steam-stopped-entry/README.md) runs.

| Check | Result | DEVICE evidence |
| --- | --- | --- |
| Stopped page and launch | Passed (UI, RPC, SSH) | Play had initial focus. Three Right presses reached Forever and the addon band remained visible. A moved Steam to its running-app screen. RPC reported the attempt busy. With the game page closed, the observer saw a replay with `--exec=launch WoWF` at 30.05 s and `_forever_/Wow.exe` at 31.97 s. Times are relative to the SSH observer's start. Back on the page, RPC reported `busy: false` and `gameRunning: running`. The page said "WoW is already running." Toast capture showed only controller notices. |
| Launch after Steam starts the shortcut | Partial (UI, RPC, SSH) | The runner used Steam's `Apps.RunGame` for the same shortcut, as in the prior started-entry run. Three Right presses from Resume did not reach Forever. The runner used `seek Forever` to focus it, then pressed A on the virtual controller. The page said "Starting…" and RPC reported busy with the entry already running. With the page closed, replay appeared at 40.20 s and the Forever executable at 42.59 s. On return, the Forever control had Steam's `Disabled` class and said "WoW is already running." RPC reported the attempt finished and WoW running. The only toast was a controller notice. D-pad navigation from Resume and activation during Steam status `1` still need a device check. |
| Picker focus, Back and icon | Passed (UI, Steam CEF) | Right from Forever reached the chevron. A opened the list on the checked Forever row. Down stayed on the last row and Up reached Classic Era. B closed the list, retained Forever and restored focus to "Choose WoW client." The screenshot showed the selected client's icon beside Forever and the DOM reported a decoded 20 × 20 px image. |
| Picker layout | Failed (UI screenshot) | The menu opened below the chevron and aligned to its right edge. At the 800 × 500 capture size, Steam's footer covered most of the selected Forever row, including its label and check mark. |
| Supported tokens | Partial (UI, RPC, SSH) | Forever was the only launchable client and `WoWF` reached the Forever executable. The picker listed Forever Beta with no launch command and Classic Era with instructions to press Play in Battle.net. Neither row was launchable. The Deck had no existing Retail fixture for `WoW`. |
| Live Steam Launching status | Passed (Steam CEF) | The local app overview went from `11` to `1` to `4` on both starts. At 40 ms sampling intervals, the first observed `1` preceded the first observed `4` by about 390 ms on the stopped-entry run and 350 ms on the Steam-initiated run. The after-Play activation happened after the reaper appeared. |
| Silent Battle.net refusal | Pending (unavailable) | The existing signed-in GE fixture provided no known launcher-side refusal. A safe refusal fixture is needed to observe the launcher message and the absence of a WoWDeck notice through completion. |
| Experimental and legacy | Pending (unavailable) | Proton Experimental and older Steam Linux Runtime directories were present. Steam exposed one matching Battle.net or WoW shortcut and its reaper used GE with SteamLinuxRuntime_4. There was no linked Experimental or legacy-runtime fixture. The live game page used the modern PlaySection and ActionRow layout. A live legacy page and linked direct-WoW page were unavailable. |

## Cleanup and local checks

The observer resumed the retry wrapper in each run. Steam's
`TerminateApp` stopped both test sessions. The final RPC returned
`busy: false`, `entryRunning: false` and `gameRunning: not_running`.
The final SSH check found none of the observed test PIDs and no
Battle.net, Wow.exe or wineserver process. The toast observer removed
itself, and `deck down` restored WoWDeck auto-update and closed its
tunnels. The merged build stayed installed. The run made no direct writes
to Steam files or settings.

`make lint typecheck test build` passed in a temporary copy of the merge
because the checkout's filesystem was nearly full. The frontend suite
passed 1,313 tests. The backend suite passed 1,757 tests and skipped four
archive tests. The Python suites passed.

## Play row and picker retest

DEVICE 2026-11-18. On the Steam Deck LCD with SteamOS 3.9.5, the runner
deployed the frontend fix on `feat/257-wow-launch` based on `908dc6f`.
The installed `dist/index.js` matched SHA-256
`070d12eada043d2a87b0c02a692105accc958af18fc6e20830fe7b836a5178b7`.
The bridge and engine hashes matched the first run. The test reused the same
GE-Proton11-12 and Forever fixture.

| Check | Result | DEVICE evidence |
| --- | --- | --- |
| Running-row navigation | Passed (UI) | With the wrapper paused and Forever enabled, the original build stopped at Manage. Changing the ActionRow layout to a horizontal row in a live probe let the next Right reach Forever. On the deployed fix, four real Right presses from Resume reached Forever, with Configure Controller and Manage as the second and third stops. The runner used no focus seek. |
| Launch after Steam starts the shortcut | Passed after Resume (UI, RPC, SSH) | The runner invoked Steam's `Apps.RunGame` for the linked shortcut. A on Forever after the Right presses changed `busy` from false to true with `entryRunning: true` and `gameRunning: not_running`. The SSH observer saw the mapped `_forever_/Wow.exe` while the retry wrapper was paused. On return, RPC reported `busy: false` and `gameRunning: running`. Steam marked Forever disabled and the control said "WoW is already running." |
| Launch from the stopped page | Passed (UI, RPC, SSH) | A on Forever opened Steam's running-app screen. RPC changed from a stopped entry to `busy: true` with `entryRunning: true`. The SSH observer saw the mapped `_forever_/Wow.exe` while the wrapper was paused. On return, RPC reported `busy: false` and `gameRunning: running`. |
| Play and addon focus | Passed (UI) | Returning to the stopped page focused Play. Up reached Check for updates in WoW addons and Down returned to Play. Three Right presses reached Forever and one more reached Choose WoW client. |
| Picker layout and Back | Passed (UI, Steam CEF) | At an 800 × 500 screenshot size, the picker opened above and aligned with the chevron. The entire Forever label and check mark were visible. CEF hit tests at the top, middle and bottom of the selected row reached the row. A opened on Forever, Down stayed there, Up reached Classic Era and B returned to the chevron with Forever still selected. The same sequence passed while WoW was running. |

The observer resumed each paused wrapper. Steam stopped both launches. The
final RPC reported `entryRunning: false`, `gameRunning: not_running` and
`busy: false`. The final process check found no Battle.net, Wow.exe or
wineserver. `deck down` restored auto-update and closed both test ports.
The fixed frontend stayed installed.

`make lint typecheck test build` passed. The frontend and tool suite passed
1,313 tests. The backend suite passed 1,757 tests with four RAR tests skipped.
All four Python suites passed, with 83 tests in total.

The earlier pending checks for activation during Steam status `1`, a silent
Battle.net refusal, other launch tokens, Proton Experimental, legacy and
direct-WoW pages, and DroidDeck remain open. The picker fixture offers only one
enabled client, so switching between two enabled clients remains unverified.

## Activation during Steam's Launching status

DEVICE 2026-11-18. The Steam Deck runner matched the installed frontend,
bridge and engine against `ddbc7629457a83468dbf576c8d82d97b8a3ee1b3`.
The frontend hash matched the Play row retest above. The bridge and
engine hashes matched the combined run.

| Check | Result | DEVICE evidence |
| --- | --- | --- |
| Activate Forever during status `1` | Passed (Steam CEF, RPC, SSH) | Three real Right presses from Play focused Forever. A CEF probe called Steam's `RunGame` once and sampled the live app status every 10 ms. It saw `11 → 1 → 4` and clicked the connected, enabled Forever button during `1`. The probe counted one `RunGame` call for the shortcut through the 3.5 s sample. RPC reported `busy: true` after activation. The SSH observer saw the mapped Forever executable while the retry wrapper was paused. Back on the game page, RPC reported `busy: false` and `gameRunning: running`. The button was disabled and said "WoW is already running." |
| Direct WoW, legacy layout and Proton Experimental | Pending (unavailable) | Steam exposed one matching shortcut and its page used the modern layout. The installed fixture used GE-Proton. Repeat with a linked direct-WoW entry, a live legacy page and a signed-in Experimental shortcut. |
| Silent Battle.net refusal | Pending (unavailable) | The GE fixture launched successfully. Repeat with a known launcher-side refusal and observe Battle.net's message, the button returning to rest and the plugin's toast stream. |
| Retail and switching enabled clients | Pending (unavailable) | The linked installations were Forever, Forever Beta and Classic Era. Only Forever had a playable executable. Repeat with Retail and Forever installed under the same linked Battle.net root. |
| DroidDeck | Pending (unavailable) | ADB reported `No route to host` and listed no device at the configured phone serial. Restore wireless ADB before checking the Steam session and running the combined arm64 flow. |

The CEF probe restored Steam's original `RunGame` function. The observer
resumed the retry wrapper before Steam stopped the test session. The
engine returned to idle and no Battle.net, WoW or wineserver process
remained. The runner closed its tunnel and found no auto-update override
to restore. The matched build stayed installed.
