import type { LaunchState } from "../backend/src/api/contracts";
import type { EventRouter } from "./engineLink";
import type { Rpc } from "./services/envelope";

type RunGame = (
  gameId: string,
  launchOptions: string,
  show: number,
  flags: number,
) => void | boolean | Promise<void | boolean>;

interface SteamLaunchApi {
  getRunGame?(): RunGame | undefined;
  isStartingOrRunning?(appId: number): boolean;
  onError?(handler: (gameId: string, action: string) => void): (() => void) | undefined;
}

export function launchControl(
  state: LaunchState | null,
  canStartSteam = false,
): { label: string; reason: string | null } | null {
  if (!state) return null;
  let reason = null;
  if (state.gameRunning === "running") reason = "WoW is already running";
  else if (state.busy) reason = "Starting…";
  else if (!state.target.launchable)
    reason = state.target.reason ?? "Start this client in Battle.net";
  else if (state.gameRunning === "unknown") reason = "Couldn't check if WoW is running";
  else if (!state.entryRunning && !canStartSteam) reason = "Steam launch is unavailable";
  return { label: state.target.shortName, reason };
}

export function createLaunchActions(
  rpc: Rpc,
  events: Pick<EventRouter, "on">,
  toast: (title: string, body: string) => void,
  steam: SteamLaunchApi = {},
) {
  let watch: { appId: number; stop: () => void } | undefined;
  const stopWatching = () => {
    const current = watch;
    watch = undefined;
    current?.stop();
  };
  events.on("launch.completed", ({ appId, clientName, outcome }) => {
    if (watch?.appId === appId) stopWatching();
    if (outcome === "steam-refused") {
      toast(`Couldn't launch ${clientName}`, "Steam couldn’t start the library entry");
    } else if (outcome === "never-ready") {
      toast(`Couldn't launch ${clientName}`, "Battle.net didn’t become ready");
    } else if (outcome === "ask-failed") {
      toast(`Couldn't launch ${clientName}`, "WoWDeck couldn’t send the request to Battle.net");
    }
  });
  return {
    select: async (appId: number, targetId: string) =>
      (await rpc("launch.select", { appId, targetId })).target,
    state: async (appId: number) => (await rpc("launch.state", { appId })).state,
    canStartSteam: () => Boolean(steam.getRunGame?.()),
    stopWatching,
    async start(appId: number) {
      const runGame = steam.getRunGame?.();
      const { state, steamStart } = await rpc("launch.start", {
        appId,
        ...(runGame && { canStartSteam: true }),
        ...(steam.isStartingOrRunning?.(appId) && { steamEntryRunning: true }),
      });
      if (!steamStart || !runGame || steam.isStartingOrRunning?.(appId)) return state;

      const { gameId, attemptId } = steamStart;
      let reported = false;
      const refuse = () => {
        if (reported) return;
        reported = true;
        void rpc("launch.steamRefused", { attemptId }).catch(() => {
          console.warn("WoWDeck could not report a Steam launch failure");
        });
      };
      stopWatching();
      const stop = steam.onError?.((id, action) => {
        if (id === gameId && action === "LaunchApp") refuse();
      });
      if (stop) watch = { appId, stop };
      try {
        void Promise.resolve(runGame(gameId, "", -1, 0)).then((result) => {
          if (result === false) refuse();
        }, refuse);
      } catch {
        refuse();
      }
      return state;
    },
  };
}
