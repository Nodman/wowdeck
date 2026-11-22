# Details! description contrast

## Build and fixture

Target was the owner's Steam Deck. The first pass used `4dea3a4` with an unchanged engine. A follow-up confirmed PR build `1.3.1-pr.304` had the same frontend SHA-256, `b66483ac295e84aabc58bcf4d71f08a0b0cca59a08b63109e7395c954606bf9c`.

The fixture was the live CurseForge description of Details! Damage Meter, opened from Get Addons with Forever selected. No addon was installed. The first pass used a 1500 by 844 CSS-pixel viewport; the follow-up used the Deck's 854 by 534 viewport.

## First pass

DEVICE, 22 November 2026, UI/CEF. The HTML-text check passed on 54 Description and Changelog text nodes, with a minimum contrast of 4.76:1 against the card gradient endpoints. Previously dark paragraphs used Steam's font at 14 px and reached at least 6.31:1. Bold markup, links and loaded images remained. Scrolling and LB/RB page switching worked after closing WoW with the owner's approval.

This did not fix the owner's reported labels. FAQ and API are transparent PNGs with dark lettering. They were outside the text-node check and still appeared dark on the card. The owner confirmed these were the affected words.

## Image-link follow-up, 22 November 2026

DEVICE, 22 November 2026, UI/CEF. The owner's open description used an 854 by 534 CSS-pixel viewport. FAQ and API were loaded 200 by 32 PNG images. An anonymous cross-origin canvas read succeeded for FAQ. Of its 6,400 pixels, 5,717 were nearly transparent. Neutral visible pixels were mostly dark.

A temporary light backdrop made both labels readable. It was removed. A blanket light backdrop for all linked images was rejected because it can hide white lettering. The local implementation and its regression check were reverted without a push or deployment.

A threshold-based transparency classifier was tried locally and parked in `.scratch/deck-contrast/`. It is not connected to the renderer. The owner proposed measuring foreground/background contrast and adjusting the worst failures instead. At that stage, a general correction was still pending. HTML text can be measured as text; raster pixels alone do not identify lettering reliably. Candidate backdrops can be compared for transparent artwork, but opaque screenshots and ambiguous images need a conservative fallback.

At the end of that investigation, the PR still contained only the original HTML-text correction. No addon or source settings were changed in the follow-up. The temporary styling was removed and the test tunnel closed.


## Selective text correction, 23 November 2026

The implementation on `fix/description-contrast` now follows spec #305. It preserves passing colours and corrects failing text runs using a bounded Oklab lightness search. The browser-side watcher handles content replacement, ancestor class/style changes and resize, and removes its wrappers and listeners on unmount. Unsupported backgrounds, colour formats and group opacity remain unresolved. Images are outside this implementation.

The initial selective-correction frontend SHA-256 was `ff0da12e5b12708103a1c88d3742193ae8d4248923d45893ed77f631b797ec25`. The local and deployed file hashes matched. A frontend-only refresh retained the installed `1.3.1-pr.304` engine. Before deployment, the original frontend and state were backed up under the plugin's test-backups directory and auto-update was temporarily guarded.

DEVICE, 23 November 2026, UI/CEF, at 854 by 534 CSS pixels:

| Claim | Result and evidence |
| --- | --- |
| Live description text meets the supported gradient bound | Passed. Description reported 11 passing and 16 corrected text runs, with no unresolved runs. Independent foreground measurements over the gradient endpoints found a minimum of 4.52:1. |
| Readable colours are preserved | Passed. A temporary rendered-content fixture retained cyan at `rgb(102, 192, 244)`. |
| Faint text on light backgrounds is corrected | Passed. Pink on an opaque white child background became `rgb(161, 100, 131)`. |
| Parent correction preserves a readable child | Passed. The parent became `rgb(178, 178, 177)` while its child on white stayed `rgb(51, 51, 51)`. |
| Alpha over the gradient is handled | Passed after a regression fix. When retaining the original alpha could not meet the conservative bound, the foreground became opaque `rgb(45, 45, 45)`. |
| Unsupported painted backgrounds are not counted as passing | Passed. A temporary unrelated gradient retained its original text colour and produced exactly one unresolved outcome. All temporary cases were then removed; Description returned to zero unresolved runs. |
| Changelog shares the correction boundary | Passed. Its 27 text runs already passed and none were changed or unresolved. |
| Scrolling, page switching and reopening still work | Passed. Down moved Description to scroll position 296; RB selected Changelog; closing and reopening returned to Description at scroll position zero. |
| Images are unchanged | Passed. The three linked images retained transparent CSS backgrounds and loaded. FAQ/API lettering is still dark because those PNGs are out of scope. An unrelated remote tracking image failed in an earlier measurement and loaded on the final pass. |
| Third-party notices share the correction boundary | Passed. The actual notices modal was opened and visually inspected. After its opening transition, all 48 text runs passed unchanged, with none unresolved. A regression test covers the opening-transition recheck. |

The only general-case fixtures added on device were temporary DOM content in the existing description container. This exercised the real watcher and browser styling but did not pass that temporary markup through sanitization. The offline SafeMarkdown integration suite covers the full sanitizer-to-renderer path, including these colour cases and security restrictions.

No addon was installed or changed. The fixtures were removed and the plugin's panels were closed. Auto-update was restored to on and both owned tunnel ports were freed during cleanup. The tested frontend remains installed. The WoW process was not started or stopped in this follow-up.


## Pre-merge alpha regression, 23 November 2026

The standards review reported no findings. The spec review found that the whole-gradient bound could recolour passing semi-transparent text. White at alpha 0.6 already passes on this card, but pairing its darkest composited foreground with the lightest background understated its contrast.

The regression was reproduced through SafeMarkdown before fixing it. The measurement now keeps foreground and background paired within bounded subdivisions of the explicitly sRGB gradient. A point below the threshold establishes failure; certified bounds establish a pass. Exhausting the check budget leaves the original colour unchanged and reports an unresolved outcome. Opaque text retains the exact range calculation. CSSOM normalization handles browsers that omit the default sRGB interpolation keyword in computed styles.

DEVICE, 23 November 2026, UI/CEF, at 1500 by 844 CSS pixels. The final deployed frontend hash is `868b55e21ef54224c566e6f4bdead2e20c47a1962da7c900fa41519b90f6ed05`. The engine remained `1.3.1-pr.304.2`.

- Passing white alpha text stayed exactly `rgba(255, 255, 255, 0.6)`.
- A failing alpha-on-gradient case was corrected to `rgba(2, 1, 1, 0.7)`, retaining alpha. Failing text at alpha 0.05 on white became opaque `rgb(118, 118, 118)`.
- Passing cyan and the readable child stayed unchanged. The deliberately unsupported gradient remained the only unresolved temporary case.
- After removing the fixtures, Description reported 11 passing, 16 corrected and zero unresolved runs. Changelog retained 27 passing runs. Third-party notices retained all 48 passing runs.
- Linked image backgrounds remained transparent. FAQ/API PNG lettering is still outside this text-only correction.

The temporary fixtures were removed, the plugin panel was closed, auto-update was restored to on and the owned tunnel ports were freed. No addon was changed and no game process was started or stopped by this review pass.
