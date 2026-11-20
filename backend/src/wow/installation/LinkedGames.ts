/**
 * The linked games (GLOSSARY: Linked game): the Steam library games WoWDeck
 * adds its game page section, tile badge and Play button to. One answer for
 * the frontend and the launch code alike, so they can't disagree.
 *
 * The list is derived on every read from what detection found (each
 * installation's Steam games, hidden installations included) and the games
 * the player added (settings `steamAddedGames`). Show in Steam
 * (`steamEnabled`) decides whether any of it counts; off keeps the list.
 */

import type { LinkedGame, LinkedGames, SteamGameLink } from "../../api/contracts";
import { ValidationError } from "../errors";
import type { StateStore } from "../storage/StateStore";
import { normalizeSteamGame } from "../storage/settings";

export class LinkedGameList {
  constructor(
    private readonly store: Pick<StateStore, "settings" | "updateSettings" | "settingsListeners">,
    /** Every installation, hidden ones too, with the Steam games detection found for it. */
    private readonly installations: () => Array<{ steamGames?: SteamGameLink[] }>,
    /** Hears every change: linkedGames.changed. */
    private readonly changed: (games: LinkedGames) => void,
  ) {
    store.settingsListeners.add(({ before, after }) => {
      if (before.steamEnabled !== after.steamEnabled || before.steamAddedGames !== after.steamAddedGames) {
        this.changed(this.get());
      }
    });
  }

  /** The list and the master switch (linkedGames.get). */
  get(): LinkedGames {
    const games = new Map<number, LinkedGame>();
    for (const installation of this.installations()) {
      for (const { appId, name } of installation.steamGames ?? []) {
        if (!games.has(appId)) games.set(appId, { appId, name, source: "found" });
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

  /** Unlink a game the player added. */
  remove(appId: number): LinkedGames {
    const added = this.store.settings.steamAddedGames;
    if (!added.some((game) => game.appId === appId)) {
      throw new ValidationError("Only a game you added can be unlinked");
    }
    this.store.updateSettings({ steamAddedGames: added.filter((game) => game.appId !== appId) });
    return this.get();
  }

  /** A scan refreshed what detection found. */
  scanned(): void {
    this.changed(this.get());
  }
}
