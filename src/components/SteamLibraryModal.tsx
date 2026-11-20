import { useEffect, useSyncExternalStore } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogControlsSectionHeader,
  DialogFooter,
  DialogHeader,
  Field,
  ModalRoot,
  ToggleField,
  showModal,
} from "@decky/ui";
import type { LinkedGame, PluginSettings } from "../../backend/src/api/contracts";
import { settingsStore } from "../settings";
import { linkedGamesStore } from "../linkedGames";
import { requestFocus } from "../focusMemory";
import { QAM_VIEW } from "../qamState";
import { descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { ScrollBuffer } from "./ScrollBuffer";
import { FocusSlot, focusTarget } from "./FocusSlot";

const TITLE = "Steam library";
/** Focus-memory view of the modal's rows. */
const VIEW = "modal.steamLibrary";
/** The Options row that opens this modal, where focus goes back on close. */
export const STEAM_LIBRARY_ROW = "steamLibrary";
/** The "No games linked" row: where focus goes when the last game is removed. */
const NO_GAMES = "games:none";
const gameKey = (game: LinkedGame) => `game:${game.appId}`;

const SOURCE: Record<LinkedGame["source"], string> = {
  found: "Found automatically",
  added: "Added by you",
};

/** The toggles for Steam's pages: they act only while Show in Steam is on. */
const PAGE_TOGGLES: Array<{
  key: "steamAutoCheck" | "steamBadge" | "steamLaunchMenu";
  label: string;
  description: string;
}> = [
  {
    key: "steamAutoCheck",
    label: "Check for updates",
    description: "When the page or tile appears, at most every 15 minutes",
  },
  { key: "steamBadge", label: "Tile badge", description: "Green when updates are waiting" },
  {
    key: "steamLaunchMenu",
    label: "Play starts WoW",
    description: "Pick the version with the arrow beside it",
  },
];

/**
 * Options › Steam library (#287): Show in Steam, the linked games (A
 * removes one, no confirmation: the picker brings it back), and what
 * WoWDeck does on their pages. Reads the settings and linked-games stores
 * and changes them through the engine (G4): the panel behind it is gone
 * while it is open.
 */
export function SteamLibraryModal({ closeModal }: { closeModal?: () => void }) {
  const stored = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const linked = useSyncExternalStore(linkedGamesStore.subscribe, linkedGamesStore.get);
  const games = linked.linked.games;
  // Off: the page rows stay in place, greyed out (S21).
  const pagesOn = stored.loaded && stored.settings.steamEnabled;

  useEffect(() => {
    if (!linkedGamesStore.get().loaded) void linkedGamesStore.load();
  }, []);

  const save = (patch: Partial<PluginSettings>) => void settingsStore.save(patch);

  // The removed row is gone: focus moves to the next game, else the one
  // above, else "No games linked" (S36: never left on nothing).
  const remove = async (game: LinkedGame) => {
    const at = games.indexOf(game);
    const neighbour = games[at + 1] ?? games[at - 1];
    if (await linkedGamesStore.remove(game)) {
      requestFocus(VIEW, neighbour ? gameKey(neighbour) : NO_GAMES);
    }
  };

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogControlsSection>
            <FocusSlot view={VIEW} id="steamEnabled">
              <ToggleField
                label="Show in Steam"
                description={
                  <span style={descriptionStyle}>Addon updates on game pages and tiles</span>
                }
                checked={stored.settings.steamEnabled}
                disabled={!stored.loaded}
                onChange={(on) => save({ steamEnabled: on })}
              />
            </FocusSlot>
          </DialogControlsSection>
          <DialogControlsSection>
            <DialogControlsSectionHeader>Linked games</DialogControlsSectionHeader>
            {!linked.loaded && <Field focusable label="Loading…" />}
            {linked.loaded && games.length === 0 && (
              <Field focusable label="No games linked" {...focusTarget(VIEW, NO_GAMES)} />
            )}
            {games.map((game) => (
              <Field
                key={game.appId}
                focusable
                label={game.name}
                description={<span style={descriptionStyle}>{SOURCE[game.source]}</span>}
                onClick={() => void remove(game)}
                onOKActionDescription="Remove"
                {...focusTarget(VIEW, gameKey(game))}
              />
            ))}
            {/* #291: "Add a game ›" and "Find games" go here. */}
          </DialogControlsSection>
          <DialogControlsSection>
            <DialogControlsSectionHeader>On these pages</DialogControlsSectionHeader>
            {PAGE_TOGGLES.map(({ key, label, description }) => (
              <FocusSlot key={key} view={VIEW} id={key}>
                <ToggleField
                  label={label}
                  description={<span style={descriptionStyle}>{description}</span>}
                  checked={stored.settings[key]}
                  disabled={!pagesOn}
                  onChange={(on) => save({ [key]: on })}
                />
              </FocusSlot>
            ))}
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={closeModal}>Close</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

/**
 * Open Steam library. Closing it (B or touch) puts focus back on its
 * Options row (S36), now when Options is still mounted, or once it mounts
 * again.
 */
export function openSteamLibraryModal(): void {
  const close = () => {
    modalResult.Close();
    requestFocus(QAM_VIEW.settings, STEAM_LIBRARY_ROW);
  };
  const modalResult = showModal(<SteamLibraryModal closeModal={close} />, window, {
    strTitle: TITLE,
    bHideMainWindowForPopouts: false,
  });
}
