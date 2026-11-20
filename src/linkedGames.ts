import type { LinkedGame, LinkedGames, SteamGameLink } from "../backend/src/api/contracts";
import { engine } from "./engineLink";
import { errorText } from "./errors";
import type { Rpc } from "./services/envelope";
import type { SettingsState } from "./settingsStore";
import { createStore, type Store } from "./store";
import { pluginToast } from "./toast";

/**
 * The linked games (GLOSSARY: Linked game) as the engine answers them, and
 * Show in Steam. Module scope: Steam's pages read it while the QAM is
 * closed, and the engine's `linkedGames.changed` keeps it current.
 */
export interface LinkedGamesState {
  linked: LinkedGames;
  /** The engine answered at least once: until then Steam's pages show nothing of WoWDeck. */
  loaded: boolean;
}

export interface LinkedGamesStore extends Pick<Store<LinkedGamesState>, "get" | "subscribe"> {
  /** Read the engine's list; an engine that is not ready keeps what is shown. */
  load(): Promise<void>;
  /** The engine's `linkedGames.changed`. */
  changed(linked: LinkedGames): void;
  /** Link a game from Steam's library (a removed one is found again); toasts the outcome. Resolves to whether it was linked. */
  add(game: SteamGameLink): Promise<boolean>;
  /** Unlink any linked game (a found one stays removed); toasts the outcome. Resolves to whether it was removed. */
  remove(game: SteamGameLink): Promise<boolean>;
  /** Find games: detect again and bring back removed games; toasts what was found. */
  find(): Promise<void>;
}

export function createLinkedGamesStore(deps: {
  rpc: Rpc;
  toast(title: string, body: string): void;
}): LinkedGamesStore {
  const store = createStore<LinkedGamesState>({
    linked: { enabled: false, games: [], removed: [] },
    loaded: false,
  });
  const replace = (linked: LinkedGames) => store.set({ linked, loaded: true });
  return {
    get: store.get,
    subscribe: store.subscribe,
    async load() {
      try {
        replace(await deps.rpc("linkedGames.get"));
      } catch {
        // engine not ready
      }
    },
    changed: replace,
    async add(game) {
      try {
        replace(await deps.rpc("linkedGames.add", { appId: game.appId, name: game.name }));
      } catch (e) {
        deps.toast(`Couldn't add ${game.name}`, errorText(e));
        return false;
      }
      deps.toast(`Added ${game.name}`, "");
      return true;
    },
    async remove(game) {
      try {
        replace(await deps.rpc("linkedGames.remove", { appId: game.appId }));
      } catch (e) {
        deps.toast(`Couldn't remove ${game.name}`, errorText(e));
        return false;
      }
      deps.toast(`Removed ${game.name}`, "");
      return true;
    },
    async find() {
      try {
        const { found, ...linked } = await deps.rpc("linkedGames.find");
        replace(linked);
        deps.toast(foundGamesText(found), "");
      } catch (e) {
        deps.toast("Couldn't look for games", errorText(e));
      }
    },
  };
}

/**
 * Find games' toast: "Found Battle.net", "Found World of Warcraft and
 * Battle.net", "Found 3 games", or "No new games found".
 */
function foundGamesText(found: SteamGameLink[]): string {
  const [first, second] = found;
  if (!first) return "No new games found";
  if (!second) return `Found ${first.name}`;
  return found.length === 2
    ? `Found ${first.name} and ${second.name}`
    : `Found ${found.length} games`;
}

/**
 * The games Steam's pages show WoWDeck on right now: none until both the
 * settings and the linked games have loaded, none while Show in Steam is off.
 */
export function shownLinkedGames(settings: SettingsState, linked: LinkedGamesState): LinkedGame[] {
  return settings.loaded && linked.loaded && linked.linked.enabled ? linked.linked.games : [];
}

/**
 * Options' Steam library status line: "On · World of Warcraft" (the one
 * linked game), "On · 2 games", "On · No games" or "Off"; empty until the
 * engine has answered.
 */
export function steamLibraryStatus({ linked, loaded }: LinkedGamesState): string {
  if (!loaded) return "";
  if (!linked.enabled) return "Off";
  const [only] = linked.games;
  if (linked.games.length === 1 && only) return `On · ${only.name}`;
  return linked.games.length === 0 ? "On · No games" : `On · ${linked.games.length} games`;
}

/** The one linked-games store, wired to the engine. */
export const linkedGamesStore = createLinkedGamesStore({ rpc: engine.rpc, toast: pluginToast });

engine.events.on("linkedGames.changed", linkedGamesStore.changed);
