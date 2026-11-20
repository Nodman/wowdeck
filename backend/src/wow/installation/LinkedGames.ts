/**
 * The linked games (GLOSSARY: Linked game): the Steam library games WoWDeck
 * adds its game page section, tile badge and Play button to. One answer for
 * the frontend and the launch code alike, so they can't disagree.
 *
 * The list is derived on every read from what detection found (each
 * installation's Steam games, hidden installations included), less the found
 * games the player removed (settings `steamRemovedGames`), plus the games
 * the player added (settings `steamAddedGames`). Show in Steam
 * (`steamEnabled`) decides whether any of it counts; off keeps the list.
 */

import type { LinkedGame, LinkedGames, SteamGameLink } from "../../api/contracts";
import { ValidationError } from "../errors";
import type { StateStore } from "../storage/StateStore";
import { normalizeSteamGame } from "../storage/settings";

export class LinkedGameList {
  constructor(
    private readonly store: Pick<
      StateStore,
      "settings" | "updateSettings" | "saveSettings" | "settingsListeners"
    >,
    /** Every installation, hidden ones too, with the Steam games detection found for it. */
    private readonly installations: () => Array<{ steamGames?: SteamGameLink[] }>,
    /** Hears every change: linkedGames.changed. */
    private readonly changed: (games: LinkedGames) => void,
  ) {
    store.settingsListeners.add(({ before, after }) => {
      if (
        before.steamEnabled !== after.steamEnabled ||
        before.steamAddedGames !== after.steamAddedGames ||
        before.steamRemovedGames !== after.steamRemovedGames
      ) {
        this.changed(this.get());
      }
    });
  }

  /** The list and the master switch (linkedGames.get). */
  get(): LinkedGames {
    const games = new Map<number, LinkedGame>();
    const removed = new Set(this.store.settings.steamRemovedGames.map(({ appId }) => appId));
    for (const installation of this.installations()) {
      for (const { appId, name } of installation.steamGames ?? []) {
        if (!games.has(appId) && !removed.has(appId)) games.set(appId, { appId, name, source: "found" });
      }
    }
    for (const { appId, name } of this.store.settings.steamAddedGames) {
      if (!games.has(appId)) games.set(appId, { appId, name, source: "added" });
    }
    return {
      enabled: this.store.settings.steamEnabled,
      games: [...games.values()].sort((a, b) => a.appId - b.appId),
    };
  }

  /** Whether this app id is a linked game right now: false for every app id while Show in Steam is off. */
  isLinked(appId: number): boolean {
    const { enabled, games } = this.get();
    return enabled && games.some((game) => game.appId === appId);
  }

  /** Link a game from Steam's library; a game detection found stays found. */
  add(sent: unknown): LinkedGames {
    const game = normalizeSteamGame(sent);
    if (!game) throw new ValidationError("Pick a game from your Steam library");
    if (!this.get().games.some(({ appId }) => appId === game.appId)) {
      this.store.updateSettings({ steamAddedGames: [...this.store.settings.steamAddedGames, game] });
    }
    return this.get();
  }

  /**
   * Unlink a linked game: a found one goes on the removed list, so automatic
   * scans leave it out; an added one is deleted (a found game the player had
   * also added, from both). Throws when the state file can't take it.
   */
  async remove(appId: number): Promise<LinkedGames> {
    const game = this.get().games.find((linked) => linked.appId === appId);
    if (!game) throw new ValidationError("That game isn't linked");
    const { steamAddedGames, steamRemovedGames } = this.store.settings;
    await this.store.saveSettings({
      steamAddedGames: steamAddedGames.filter((added) => added.appId !== appId),
      ...(game.source === "found" && {
        steamRemovedGames: [...steamRemovedGames, { appId, name: game.name }],
      }),
    });
    return this.get();
  }

  /** A scan refreshed what detection found. */
  scanned(): void {
    this.changed(this.get());
  }
}
