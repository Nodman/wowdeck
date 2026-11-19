# Steam Deck launch delivery spike

[#280](https://github.com/sigboe/wowdeck/issues/280) remains open. The Deck
started WoW Forever through GE-Proton replay while the existing retry wrapper
was paused. The same test still needs a linked, signed-in Proton Experimental
fixture. The production plugin also needs its own launch callback and a
live check of the legacy game-page layout.

## Build and fixture

DEVICE 2026-11-18. The Deck test runner deployed the frontend from
`14533b5102800d8ee101de392a6cdf981eb7b745` on the ticket branch. It reloaded
WoWDeck 1.2.1 with the existing engine. There were no engine changes.

| Installed file | SHA-256 |
| --- | --- |
| `dist/index.js` | `aa3d5615636ce36a1d752ba1c04402af5d6bca31e5d17df93e625705575a6633` |
| `main.py` | `fbe53d749f47d477493d2040fe7e0aba3290bacadbd8a0d3bf0e470be48256f7` |
| `bin/wowdeck-x86_64` | `f8ddedcf64da14ffd857ee3451e00812607e2c69cd29ef29527b86fde30222cd` |

The existing World of Warcraft shortcut had app ID `4221385996`.
`installations.list` returned that link for the three detected clients.
The run used the existing Forever installation under
`~/Applications/World of Warcraft/_forever_/`. The shortcut already
ran `launch-forever.py` with the Battle.net target and Forever launch
option. No game or compatibility tool was installed for this test.

## GE-Proton result

DEVICE 2026-11-18, Steam UI context and SSH process observation. In CEF's
`SharedJSContext`, with WoWDeck loaded, the probe called
`SteamClient.Apps.RunGame("18130714796645941248", "", -1, 0)`.
`GetGameID()` returned that exact string. This call ran as a probe in the
plugin's Steam context. A deployed WoWDeck control has yet to call it.

The shortcut ran GE-Proton11-12-x86_64 with `SteamLinuxRuntime_4`. The
first run reached `_forever_/Wow.exe`, and the original wrapper could
have sent its own ask. In the second run the observer paused only the
wrapper process once its reaper child was visible. It resumed the wrapper
after recording the result. Times below are seconds since the SSH observer
started.

| Time | Observation |
| --- | --- |
| 1.58 | The wrapper (PID 49911) and its reaper child (PID 49912) were visible. The observer paused the wrapper. |
| 6.88 | The first Battle.net process appeared in the shortcut prefix (PID 50110). |
| 16.63 | A Battle.net process in that prefix had `--type=renderer` (PID 50340). |
| 21.65 | The probe spawned the replay (PID 50420) after 5.02 seconds of renderer presence. |
| 24.82 | `Z:\home\deck\Applications\World of Warcraft\_forever_\Wow.exe` appeared in the prefix (PID 50535). The observer resumed the wrapper. |

The WoW process appeared 3.17 seconds after replay. Executable appearance
was the observation point. The run ended before gameplay.

## Delivery route

Use Proton replay as the candidate for the engine, with Experimental
verification still required. On GE, the reaper's NUL-delimited
`/proc/<pid>/cmdline` exposed the complete command from
`_v2-entry-point` onward even after the renderer came up. The inner
Proton Python process retained the Proton path and verb but lacked the
outer runtime entry point. Match the shortcut's `STEAM_COMPAT_DATA_PATH`
and the Battle.net processes' `WINEPREFIX` before relying on either.
The reaper's argv and environment were readable as the Deck user over
SSH. Confirm access from the engine when wiring the spawner.

Drop Steam's reaper prefix from argv. Replace both
`--verb=waitforexitandrun` and the separate Proton verb
`waitforexitandrun` with their `run` forms. Remove the previous
`--exec=` argument and append the single argument `--exec=launch WoWF`.
The probe passed an argv array directly to the spawner. The space belongs
inside the argument and the surrounding shell quotes do not belong in it.

Use the environment of the process that supplied the command. The probe
kept `STEAM_COMPAT_*`, `Steam*`, `PROTON_*`, and an allowlist of
user, locale, display and session variables. `STEAM_COMPAT_TOOL_PATHS`
named both the chosen GE tool and the runtime. Replay needed no direct Wine
loader lookup. `WINELOADER` was absent in the sampled Battle.net
environment. The executable symlink for the main Battle.net process
pointed under the GE tool to `files/lib/wine/i386-unix/wine-preloader`.

Earlier scratch evidence covers two different setups.
`deck-bnet/launch-forever.py` replayed argv inherited inside the
shortcut. `deck-bnet/game-output` records the Forever executable from
the earlier Deck investigation. `battlenet-headless-install.md` section
6 records Experimental's namespace route on another machine. That run
used `nsenter` and a known Wine loader to open an install dialog. The
namespace route still lacks a Deck WoW launch result.

## Experimental and legacy coverage

- **Proton Experimental, pending (unavailable).** The tool was installed,
  but the only matching shortcut exposed in Steam used GE. The second
  Battle.net prefix on disk, `2272143408`, recorded GE-Proton10-15 and
  had no corresponding live shortcut. An isolated invocation outside
  that shortcut could test delivery, but would not establish the
  Steam-to-client path required by #280. Repeat with an already prepared,
  signed-in Experimental shortcut. This run left compatibility tool
  settings alone.
- **Modern game page, partial (UI).** On
  `/routes/library/app/4221385996`, `DFL.findModule` found the
  40-key module with `PlaySection`, `ActionRow`,
  `ActionButtonAndStatusPanel`, `AppActionButton` and `AppButtons`.
  Both `DFL.appActionButtonClasses` and `DFL.playSectionClasses`
  existed and were separate modules. The live row rendered, in order,
  the Play group, status and stats, and Steam's buttons. The prototype
  returned no insertion when given the live section's React props,
  because its children include an opaque component that renders the
  action row. Feeding the locator the rendered row props under the
  section returned index 3 in a three-child array, after `AppButtons`.
  Patch the render that exposes the row's children. A control and its
  Right-button focus order were not exercised.
- **Legacy game page, pending (unavailable).** The prototype returned
  no insertion on a synthetic tree with the legacy `ActionSection`
  anchor and without the modern `PlaySection` anchor. Only the modern
  layout was observed in the active Steam UI. Repeat on a live legacy
  page and verify that the existing addon section still appears.

## Cleanup

Steam's `TerminateApp` stopped both test sessions. The final process
check found no Battle.net, Wow.exe or wineserver process. `deck down`
restored WoWDeck auto-update and closed both forwarded ports. The tested
frontend remained installed. The runtime probes left no hooks or probe
files on the Deck.

The probes made no direct Steam file or settings edits. Between the
pre- and post-launch checks for the controlled run, Steam's `config.vdf`
hash was unchanged and its `shortcuts.vdf` hash changed. The check
recorded only hashes, so it did not identify the field Steam wrote.

## Replay failure reporting

The engine can prove that replay failed to start if the executable checks or
spawn fail. For a replay that spawns and exits with an error, it recognizes
the pressure-vessel `bwrap` preflight failure recorded in the
[#257 Kaptan exploration](https://github.com/sigboe/wowdeck/issues/257).
It reads a bounded prefix of replay stderr and discards it without logging.
The engine keeps the usual retry schedule for spawned replays. If every
replay has a proven startup failure, the attempt ends with one failure notice.
An exit code, a signal, an unclassified runtime diagnostic or silence cannot
establish whether Battle.net got the request. If any replay may have reached
Battle.net, the attempt can end silently. The ld cache diagnostic from
Kaptan can accompany a runtime failure, but the diagnostic alone does not
prove pressure-vessel stopped before invoking Proton.
