import { DialogButton } from "@decky/ui";
import { useState, useSyncExternalStore } from "react";
import { FaGamepad } from "react-icons/fa";
import { addonSession } from "../session";
import { settingsStore } from "../settings";
import { linkedSteamGames } from "../steamLibrary";
import { launchControl } from "../steamLaunch";
import { steamLaunch, steamLaunchState } from "../steamLaunchActions";
import { useResource } from "../useResource";
import { descriptionStyle } from "../steamTheme";
import { toastError } from "../toast";

export function LinkedSteamLaunchControl({ appId }: { appId: number }) {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const { installations } = useSyncExternalStore(addonSession.subscribe, addonSession.get);
  const linked = linkedSteamGames(installations, settings.steamGame, settings.steamAutoLink);
  return linked.some((game) => game.appId === appId) ? (
    <SteamLaunchControl key={appId} appId={appId} />
  ) : null;
}

function SteamLaunchControl({ appId }: { appId: number }) {
  const key = String(appId);
  const { data, error, loading } = useResource(steamLaunchState, key);
  const [submitting, setSubmitting] = useState(false);

  // Until the engine identifies the shortcut, it may be a direct WoW entry.
  const view = launchControl(data, steamLaunch.canStartSteam());
  if (!view) return null;
  const reason =
    error ?? (submitting ? "Starting…" : loading ? "Checking WoW launch status…" : view.reason);
  const start = async () => {
    if (reason) return;
    setSubmitting(true);
    try {
      await steamLaunch.start(appId);
    } catch (caught) {
      toastError(`Couldn't launch ${view.label}`, caught);
    } finally {
      steamLaunchState.invalidate((candidate) => candidate === key);
      setSubmitting(false);
    }
  };

  return (
    <div>
      <DialogButton
        style={{ minWidth: 0, width: "auto" }}
        disabled={reason !== null}
        onClick={() => void start()}
      >
        <FaGamepad aria-hidden /> {view.label}
      </DialogButton>
      {reason && <div style={descriptionStyle}>{reason}</div>}
    </div>
  );
}
