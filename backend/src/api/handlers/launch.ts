import type { HandlerTable } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";

export function launchHandlers({ launch, installationService, store }: Pick<HandlerDeps, "launch" | "installationService" | "store">) {
  return {
    "launch.select": async ({ appId, targetId }) => ({
      target: await launch.select(appId, targetId, (target) => {
        const steamLaunchTargets = { ...store.settings.steamLaunchTargets, [appId]: target.id };
        if (target.kind === "battlenet") {
          // Battle.net is no installation: the active one stays as it is.
          store.updateSettings({ steamLaunchTargets });
          return;
        }
        // The active installation and this shortcut's preference advance together.
        installationService.require(target.id);
        store.updateSettings({ selectedInstallationId: target.id, steamLaunchTargets });
      }),
    }),
    "launch.state": async ({ appId }) => ({ state: await launch.state(appId) }),
    "launch.start": ({ appId, canStartSteam, steamEntryRunning }) =>
      launch.start(appId, canStartSteam, steamEntryRunning),
    "launch.steamRefused": async ({ attemptId }) => launch.steamRefused(attemptId),
    "launch.icon": async ({ appId, targetId }) => ({ icon: (await launch.icon(appId, targetId)) ?? null }),
  } satisfies Partial<HandlerTable>;
}
