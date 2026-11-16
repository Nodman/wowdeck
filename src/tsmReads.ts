import { systemClock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource } from "./keyedResource";
import type {
  TradeSkillMasterAccount,
  TradeSkillMasterAuthStatus,
  TradeSkillMasterDestination,
} from "../backend/src/api/contracts";
import { useResource } from "./useResource";

/**
 * What the TradeSkillMaster views read from the engine, one keyed resource
 * each: a view that reads follows the resource's freshness rules instead of
 * guarding its own request. The account-wide reads share one key.
 */
const ACCOUNT_KEY = "account";

const STATUS_POLL_MS = 1000;

/** The sign-in state, read again every second while a view shows it. */
export const tsmStatus = createKeyedResource<TradeSkillMasterAuthStatus>({
  read: () => engine.rpc("tradeskillmaster.status"),
  errorText: () => "Couldn't read the TradeSkillMaster sign-in",
  clock: systemClock,
  pollMs: STATUS_POLL_MS,
});

const account = createKeyedResource<TradeSkillMasterAccount>({
  read: () => engine.rpc("tradeskillmaster.account", {}),
  errorText: () => "Could not load followed realms",
  clock: systemClock,
});

/** One installation's destination data (realms, regions, freshness). */
export const tsmDestination = createKeyedResource<TradeSkillMasterDestination>({
  read: (installationId) => engine.rpc("tradeskillmaster.destination", { installationId }),
  errorText: () => "Could not load auction data",
  clock: systemClock,
});

/** The follows an uninstall could remove, per installation. */
export const tsmCleanupPreview = createKeyedResource<TradeSkillMasterAccount["follows"]>({
  read: (installationId) => engine.rpc("tradeskillmaster.cleanupPreview", { installationId }),
  errorText: () => "Could not preview account cleanup",
  clock: systemClock,
});

engine.events.on("tradeskillmaster.changed", () => {
  account.invalidate();
  tsmDestination.invalidate();
  tsmCleanupPreview.invalidate();
});

export const useTsmStatus = () => useResource(tsmStatus, ACCOUNT_KEY);
export const useTsmAccount = () => useResource(account, ACCOUNT_KEY);
export const useTsmDestination = (installationId: string) =>
  useResource(tsmDestination, installationId);
export const useTsmCleanupPreview = (installationId: string) =>
  useResource(tsmCleanupPreview, installationId);

/** An action's answer for the status: shown at once, ahead of the next poll. */
export const putTsmStatus = (status: TradeSkillMasterAuthStatus) =>
  tsmStatus.put(ACCOUNT_KEY, status);
/** An action's answer for an installation's destination. */
export const putTsmDestination = (installationId: string, data: TradeSkillMasterDestination) =>
  tsmDestination.put(installationId, data);
/** Forget an installation's cleanup preview (its dialog closed). */
export const forgetTsmCleanupPreview = (installationId: string) =>
  tsmCleanupPreview.forget(installationId);

/** Drop everything read so far, so the next view starts empty (tests). */
export function resetTsmReads(): void {
  for (const resource of [tsmStatus, account, tsmDestination, tsmCleanupPreview]) {
    resource.retainOnly([]);
  }
}
