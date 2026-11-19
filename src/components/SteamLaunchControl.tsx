import { DialogButton, Focusable } from "@decky/ui";
import { cloneElement, useState, useSyncExternalStore, type ReactElement } from "react";
import { FaBoxOpen } from "react-icons/fa";
import { BATTLE_NET_LAUNCH_TARGET } from "../../backend/src/api/contracts";
import { installationSwitchBlocked } from "../addonSession";
import { SegmentMenu } from "./SegmentMenu";
import { wowdeckSharedStyleCss } from "../sharedStyles";
import { addonSession } from "../session";
import { settingsStore } from "../settings";
import { linkedSteamGames } from "../steamLibrary";
import { launchControl } from "../steamLaunch";
import { steamLaunch, steamLaunchState } from "../steamLaunchActions";
import { useResource } from "../useResource";
import { descriptionStyle } from "../steamTheme";
import { toastError } from "../toast";

export interface SteamActionRowProps {
  children?: unknown;
  "flow-children"?: string;
}

function LaunchIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img src={src} width={20} height={20} alt="" onError={() => setFailed(true)} />
  ) : (
    <FaBoxOpen aria-hidden />
  );
}

export function SteamLaunchActionRow({
  appId,
  row,
  index,
}: {
  appId: number;
  row: ReactElement<SteamActionRowProps>;
  index: number;
}) {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const session = useSyncExternalStore(addonSession.subscribe, addonSession.get);
  const linked = linkedSteamGames(
    session.installations,
    settings.steamGame,
    settings.steamAutoLink,
  );
  const key = String(appId);
  const { data, error, loading, refresh } = useResource(
    steamLaunchState,
    linked.some((game) => game.appId === appId) ? key : null,
  );
  const [submitting, setSubmitting] = useState(false);

  // Until the engine identifies the shortcut, it may be a direct WoW entry.
  const view = launchControl(data, steamLaunch.canStartSteam());
  const children = row.props.children;
  if (error || !data || !view || !Array.isArray(children)) return row;
  const reason = session.switching
    ? "Switching installation…"
    : submitting
      ? "Starting…"
      : loading
        ? "Checking WoW launch status…"
        : view.reason;
  const switchReason = session.switching
    ? "Switching installation…"
    : submitting
      ? "Starting…"
      : installationSwitchBlocked(session);

  const pick = async (targetId: string) => {
    if (switchReason) return;
    if (targetId === BATTLE_NET_LAUNCH_TARGET) {
      // Battle.net is no installation: My Addons stays on the active one.
      await steamLaunch.select(appId, targetId);
      await refresh();
      return;
    }
    await addonSession.selectInstallation(targetId, async (id) => {
      await steamLaunch.select(appId, id);
      await refresh();
    });
  };
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

  const actions = children.slice();
  actions.splice(
    index,
    0,
    <div key="wowdeck-launch" style={{ position: "relative" }}>
      <style>{wowdeckSharedStyleCss()}</style>
      <Focusable flow-children="row" style={{ display: "flex", gap: 8 }}>
        <DialogButton
          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, width: "auto" }}
          disabled={reason !== null}
          onClick={() => void start()}
        >
          <LaunchIcon key={data.target.icon} src={data.target.icon} />
          {view.label}
        </DialogButton>
        <SegmentMenu
          menuLabel="Choose WoW client"
          placement="above"
          selected={data.target.id}
          choices={data.clients.map((client) => ({
            data: client.id,
            label: client.shortName,
            disabledReason: client.launchable
              ? (switchReason ?? undefined)
              : (client.reason ?? "Start this client in Battle.net"),
          }))}
          onPick={(id) => void pick(id)}
        />
      </Focusable>
      {reason && <div style={descriptionStyle}>{reason}</div>}
    </div>,
  );
  // DEVICE: Steam's ActionRow accepts Focusable's row layout. Its default
  // navigation stopped at Manage on the running shortcut.
  return cloneElement(row, { "flow-children": "row", children: actions });
}
