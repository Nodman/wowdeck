import { RowChevron } from "../RowGlyph";
import { useSyncExternalStore } from "react";
import { Field, PanelSection, ToggleField } from "@decky/ui";

import { descriptionStyle } from "../../steamTheme";
import { settingsStore } from "../../settings";
import { linkedGamesStore } from "../../linkedGames";
import { openSteamGamePicker } from "../SteamGamePicker";
import { SettingsRow } from "./common";

/**
 * BEYOND-05: linked games get an addons section on their game page. The
 * toggle is Show in Steam; the picker adds a game and unlinks an added one
 * (linkedGamesStore, the engine's list).
 */
export function SteamLibrarySection() {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const { linked } = useSyncExternalStore(linkedGamesStore.subscribe, linkedGamesStore.get);
  const games = linked.games;
  const added = games.find((game) => game.source === "added");

  return (
    <PanelSection title="Steam library">
      <SettingsRow id="steamEnabled">
        <ToggleField
          label="Link detected Steam games"
          description={
            <span style={descriptionStyle}>
              Show addon updates on detected WoW and Battle.net game pages and home tiles
            </span>
          }
          checked={settings.steamEnabled}
          onChange={(on) => void settingsStore.save({ steamEnabled: on })}
        />
      </SettingsRow>
      <SettingsRow id="steamAddedGames">
        <Field
          focusable
          label="World of Warcraft in Steam"
          description={
            <span style={descriptionStyle}>
              {added
                ? `${added.name}: its game page and tile show addon updates`
                : games.length > 0
                  ? `${games.length} detected Steam entries linked. Pick another entry to link manually`
                  : "Pick its library entry (WoW or Battle.net) to show addon updates there"}
            </span>
          }
          onClick={() =>
            openSteamGamePicker(
              games,
              (game) => void linkedGamesStore.add(game),
              (game) => void linkedGamesStore.remove(game),
            )
          }
        >
          <RowChevron />
        </Field>
      </SettingsRow>
      {games.length > 0 && (
        <>
          <SettingsRow id="steamAutoCheck">
            <ToggleField
              label="Check for updates when shown"
              description={
                <span style={descriptionStyle}>
                  When its game page or tile appears; at most every 15 minutes
                </span>
              }
              checked={settings.steamAutoCheck}
              onChange={(on) => void settingsStore.save({ steamAutoCheck: on })}
            />
          </SettingsRow>
          <SettingsRow id="steamBadge">
            <ToggleField
              label="Show a badge on its tile"
              description={
                <span style={descriptionStyle}>
                  Green when updates are waiting, on the home screen and in the library
                </span>
              }
              checked={settings.steamBadge}
              onChange={(on) => void settingsStore.save({ steamBadge: on })}
            />
          </SettingsRow>
          <SettingsRow id="steamLaunchMenu">
            <ToggleField
              label="Choose the WoW version from Play"
              description={
                <span style={descriptionStyle}>
                  Play's menu lists your WoW versions, and Play starts the one you pick through
                  Battle.net. Off: Steam's own Play button.
                </span>
              }
              checked={settings.steamLaunchMenu}
              onChange={(on) => void settingsStore.save({ steamLaunchMenu: on })}
            />
          </SettingsRow>
        </>
      )}
    </PanelSection>
  );
}
