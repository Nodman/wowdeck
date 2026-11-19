import { systemClock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource } from "./keyedResource";
import { createLaunchActions } from "./steamLaunch";
import { pluginToast } from "./toast";

// DEVICE 2026-11-18: a shortcut launches with its decimal game ID string.
// Without RunGame, only the already-running Battle.net path is available.
// See docs/hardware/2026-11-18-steam-launch-delivery.
export const steamLaunch = createLaunchActions(engine.rpc, engine.events, pluginToast, {
  getRunGame() {
    const apps = window.SteamClient?.Apps;
    return typeof apps?.RunGame === "function" ? apps.RunGame.bind(apps) : undefined;
  },
  isStartingOrRunning(appId) {
    // Steam's local display status covers the gap between Play and a reaper.
    const store = window.appStore;
    if (typeof store?.GetAppOverviewByAppID !== "function") return false;
    const status = store.GetAppOverviewByAppID(appId)?.local_per_client_data?.display_status;
    return status === 1 || status === 4; // EDisplayStatus.Launching or Running
  },
  onError(handler) {
    const apps = window.SteamClient?.Apps;
    if (typeof apps?.RegisterForGameActionShowError !== "function") return;
    try {
      const registration = apps.RegisterForGameActionShowError((_id, gameId, action) => {
        handler(gameId, action);
      });
      return () => registration?.unregister?.();
    } catch {
      // Process observation still works when Steam cannot register this listener.
      return undefined;
    }
  },
});

export const steamLaunchState = createKeyedResource({
  read: (key) => steamLaunch.state(Number(key)),
  errorText: () => "Couldn't check WoW launch status",
  clock: systemClock,
  pollMs: 2000,
});

engine.events.on("launch.completed", ({ appId }) => {
  steamLaunchState.invalidate((key) => key === String(appId));
});
