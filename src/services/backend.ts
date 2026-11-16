/**
 * The frontend's way to the two processes behind it, both typed by
 * backend/src/api/contracts.ts. `rpc` calls an engine method (`MethodMap`),
 * which main.py forwards unchanged; `bridge` calls a method main.py answers
 * itself (`BridgeMethodMap`).
 *
 * Decky turns any exception raised in main.py into the useless text
 * "Python Exception", so main.py returns engine failures as
 * `{ __error: { code, message } }` (see Plugin._rpc) and both callers
 * rethrow them with the engine's real message.
 */

import { callable, addEventListener, removeEventListener } from "@decky/api";
import type { BridgeEventMap } from "../../backend/src/api/contracts";
import { bridgeVia, rpcVia } from "./envelope";

/** Call an engine method: `rpc("addons.update", { addonId })`. */
export const rpc = rpcVia(callable<[method: string, params?: object], unknown>("rpc"));

/** Call one of main.py's own methods: `bridge("read_text_file", path)`. */
export const bridge = bridgeVia((method, ...args) => callable<unknown[], unknown>(method)(...args));

export function onBackendEvent(
  handler: (event: BridgeEventMap["backend_event"]) => void,
): () => void {
  const listener = addEventListener<[payload: BridgeEventMap["backend_event"]]>(
    "backend_event",
    handler,
  );
  return () => removeEventListener("backend_event", listener);
}
