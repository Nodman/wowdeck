import type { HandlerTable } from "../../bridge/jsonl";
import type { LaunchService } from "../../wow/launch/LaunchService";

export function launchHandlers({ launch }: { launch: LaunchService }) {
  return {
    "launch.state": async ({ appId }) => ({ state: await launch.state(appId) }),
    "launch.start": ({ appId, canStartSteam, steamEntryRunning }) =>
      launch.start(appId, canStartSteam, steamEntryRunning),
    "launch.steamRefused": async ({ attemptId }) => launch.steamRefused(attemptId),
  } satisfies Partial<HandlerTable>;
}
