import { createStore, type Store } from "./store";
import { engine } from "./engineLink";
import type { TradeSkillMasterAuthStatus } from "../backend/src/api/contracts";
import type { Rpc } from "./services/envelope";

export interface TsmSession extends Pick<Store<TradeSkillMasterAuthStatus>, "get" | "subscribe"> {
  /**
   * Read the sign-in state (one read at a time); `notify` hears a session
   * that has just ended.
   */
  read(notify: () => void): Promise<void>;
}

export function createTsmSession(deps: { rpc: Rpc }): TsmSession {
  const store = createStore<TradeSkillMasterAuthStatus>({ state: "off", account: null });
  let reading = false;
  return {
    get: store.get,
    subscribe: store.subscribe,
    async read(notify) {
      if (reading) return;
      reading = true;
      try {
        const status = await deps.rpc("tradeskillmaster.status");
        const previous = store.get().state;
        store.set(status);
        if (status.state === "signedOut" && previous !== "signedOut") notify();
      } finally {
        reading = false;
      }
    },
  };
}

/** The one TradeSkillMaster sign-in state, wired to the engine. */
export const tsmSession = createTsmSession({ rpc: engine.rpc });
export const tsmActionRequired = (status: TradeSkillMasterAuthStatus): boolean =>
  status.state === "signedOut";
export const tsmOptionsSources = (): string[] => ["TradeSkillMaster"];

export function tsmDestinationVisible(
  providers: readonly { id: string; enabled: boolean }[],
): boolean {
  return providers.some((p) => p.id === "TradeSkillMaster" && p.enabled);
}
