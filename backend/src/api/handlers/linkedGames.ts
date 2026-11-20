/** RPC handlers: the linked games (LinkedGameList). */

import type { HandlerTable } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";

export function linkedGamesHandlers({ linkedGames }: Pick<HandlerDeps, "linkedGames">) {
  return {
    "linkedGames.get": async () => linkedGames.get(),
    "linkedGames.add": async ({ appId, name }) => linkedGames.add({ appId, name }),
    "linkedGames.remove": async ({ appId }) => linkedGames.remove(appId),
  } satisfies Partial<HandlerTable>;
}
