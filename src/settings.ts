import { engine } from "./engineLink";
import { pluginToast } from "./toast";
import { createSettingsStore } from "./settingsStore";

/** The one settings store (settingsStore.ts), wired to the engine. */
export const settingsStore = createSettingsStore({
  get: async () => (await engine.rpc("settings.get")).settings,
  set: async (patch) => (await engine.rpc("settings.set", { settings: patch })).settings,
  toast: pluginToast,
});
