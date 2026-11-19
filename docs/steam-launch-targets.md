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

| Client | Known command | Behavior in WoWDeck |
| --- | --- | --- |
| Retail | `launch WoW` | Available. Still needs a device launch result. |
| Forever | `launch WoWF` | Available. Prior GE-Proton device runs started Forever. |
| Classic | `launch WoWC`, `launch_uid wow_classic` | Disabled. The product command follows Battle.net's last Classic selection. The version command selects Classic and leaves Play to the player. |
| Classic Era, Anniversary, Titan Reforged, Retail PTR | `launch_uid wow_classic_era`, `wow_classic_anniversary`, `wow_classic_titan`, `wowt` respectively | Disabled. These commands select a version in Battle.net. Press Play there to launch it. |
| Retail Beta, Retail XPTR, Classic PTR, Classic Era PTR, Forever Beta, China Beta | No command in the launch table | Disabled. Start these clients in Battle.net. |

WoWDeck only sends product commands that target a specific installed client.
Each client's command lives in the client table, `backend/src/wow/clients.ts`.
See the [launch code observations](https://steamcommunity.com/sharedfiles/filedetails/?id=1113049716)
and Skip Game Launcher's [version command notes](https://github.com/voc0der/Skip-Game-Launcher/blob/master/CONTRIBUTING.md#battlenet-game-versions)
and [UID catalog](https://github.com/voc0der/Skip-Game-Launcher/blob/master/games.json).

## Device checks

The [launch delivery spike](hardware/2026-11-18-steam-launch-delivery/README.md)
and [started-entry run](hardware/2026-11-18-steam-started-entry/README.md)
record the earlier Forever results on Steam Deck. Those builds preceded
the picker. Verify Retail and the picker on device before release. The
combined DroidDeck run follows integration of #282 and #283.

| Step | Expected |
| --- | --- |
| Open the chevron while WoW runs. Check the list and press B. | Only installations linked to the entry's WoW root appear. Unsupported rows show their reason. B returns focus to the chevron. |
| Reopen the picker and select the other supported client. Check My Addons and then reopen the game page. | My Addons shows the chosen installation. The game page shows the same client's name and icon or WoWDeck glyph. |
| Stop the existing client. Use the launch control with Battle.net running, then repeat with the Steam entry stopped. | The chosen client starts in the linked shortcut's prefix. |
