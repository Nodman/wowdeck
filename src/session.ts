import * as api from "./services/backend";
import { pluginToast, toastError } from "./toast";
import { settingsStore } from "./settings";
import { createAddonSession } from "./addonSession";

/** The one addon session (addonSession.ts), wired to the engine. */
export const addonSession = createAddonSession({
  rpc: api.rpc,
  toast: pluginToast,
  toastError,
  autoUpdateOn: () => settingsStore.get().settings.autoUpdate,
});

/**
 * The active installation's id, for a call made on its behalf (Get Addons,
 * Details), read when the call is made. Empty with none: the engine refuses
 * the call rather than guess one.
 */
export function activeInstallationId(): string {
  return addonSession.get().selectedId ?? "";
}
