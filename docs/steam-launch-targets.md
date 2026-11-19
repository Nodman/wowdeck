# Steam game page launch targets

The chevron opens the client picker even while WoW is running. Up and Down
move through the choices. A selects an available client. B closes the picker.
Both actions return focus to the chevron. Steam Play keeps initial focus.
The launch button shows the selected client and its executable icon. WoWDeck
uses its own glyph when the icon is missing, unreadable or fails to render.

The picker lists Battle.net first, then the linked WoW clients in client table
order. Battle.net is selected until the player picks a client. Starting it
starts the Steam entry and sends Battle.net no launch command, as Steam's own
Play does. Its icon comes from the launcher executable.

A choice is saved per Steam shortcut. Picking a client also sets the active
installation in My Addons. Picking Battle.net leaves it unchanged. Later
changes in My Addons leave the saved launch target in place. Choices saved by
earlier builds keep working.
An attempt already in progress keeps its original target. The picker uses
installation links for this app ID and requires a single canonical WoW root.
Multiple linked roots or a client symlink escaping its registered root hide
the control. A client linked only to a different shortcut never becomes a choice.

## Battle.net commands

Battle.net starts a game with `--exec="launch <code>"`, where the code names
a game family, not a version. Only three WoW codes start a client:

| Client | Command | In WoWDeck |
| --- | --- | --- |
| Retail | `launch WoW` | Available |
| Forever | `launch WoWF` | Available |
| Classic | `launch WoWC` | Disabled. Battle.net starts whichever Classic version the player last selected |
| Classic Era, Anniversary, Titan Reforged, Retail PTR, Retail XPTR, Retail Beta, Classic PTR, Classic Era PTR, Forever Beta | `launch_uid <uid>` only | Disabled. This selects the version in Battle.net and doesn't start it |
| China Beta | None known | Disabled |

Each client's code or version UID lives in the client table,
`backend/src/wow/clients.ts`. The UIDs are the ones Battle.net itself lists
(its log on the Deck names `wow_ptr`, `wow_ptr_x`, `wow_classic_ptr`,
`wow_classic_era_ptr`, `wow_classic_beta`, `wow_classic_era`,
`wow_classic_anniversary` and `wowf`). `wow_beta` comes from the
[wowdev product table](https://wowdev.wiki/Agent), and `wow_classic_titan`
from Skip Game Launcher's [UID catalog](https://github.com/voc0der/Skip-Game-Launcher/blob/master/games.json).

Nothing external starts a version outright. On the Deck (2026-11-18), with
Battle.net signed in:

- `launch wow_classic_era`, `launch wow_classic_beta` and `launch WoWB` did
  nothing. Battle.net looked them up as game families and found none.
- `launch_uid` selected the version. A following `launch WoW` or
  `launch WoWF` replaced that selection and started the family's own
  client.
- Battle.net starts a client as `<client>.exe -launcherlogin -uid <uid>` and
  hands it a launch token. Running the client with the same arguments
  doesn't sign it in; it exits on its own.

Battle.net 2.53.8's own command list, read from `battle.net.dll` on the
Deck (2026-11-19), has no other way in. `--exec` takes `launch`,
`launch_uid`, `launch_register`, `focus`, `handle_uri`, `install`,
`repair`, `modify`, `login`, `logout` and a few more. Only `launch` starts
a game (`LaunchGameByProduct`). A `battlenet://` link can also start one
(`LaunchGameByUri`), but only with a token, account id and timestamp
that Blizzard's website signs for the signed-in account. Without them it
only focuses a game. WoWDeck can't build those links.

`launch WoWC` doesn't start a version that `launch_uid` selected either.
On the Deck, `launch_uid wow_classic_era` switched Battle.net to Classic
Era, and two `launch WoWC` commands after it started nothing. A
`launch WoWF` sent the same way started Forever at once. Battle.net
showed an "Unsupported" badge on Classic Era, and its meaning is not
known. A Classic version without that badge, such as Mists of Pandaria
Classic, is not installed on the Deck, so `WoWC` after `launch_uid`
stays untested there.

The [Steam launch report](hardware/2026-11-18-steam-launch-integration/README.md)
has the log lines. See also Skip Game Launcher's
[version command notes](https://github.com/voc0der/Skip-Game-Launcher/blob/master/CONTRIBUTING.md#battlenet-game-versions).

## Device checks

The [launch delivery spike](hardware/2026-11-18-steam-launch-delivery/README.md)
and [started-entry run](hardware/2026-11-18-steam-started-entry/README.md)
record the earlier Forever results on Steam Deck. Those builds preceded
the picker. Verify Retail and the picker on device before release. The
combined DroidDeck run follows integration of #282 and #283.

| Step | Expected |
| --- | --- |
| Open the chevron while WoW runs. Check the list and press B. | Only installations linked to the entry's WoW root appear. Clients WoWDeck can't start are greyed out. B returns focus to the chevron. |
| Reopen the picker and select the other supported client. Check My Addons and then reopen the game page. | My Addons shows the chosen installation. The game page shows the same client's name and icon or WoWDeck glyph. |
| Stop the existing client. Select the client in the Play button's menu and press Play with Battle.net running, then repeat with the Steam entry stopped. | The chosen client starts in the linked shortcut's prefix. |
