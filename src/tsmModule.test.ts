import { expect, test } from "bun:test";
import { createTsmModule } from "./tsmReads";
import { createFakeEngine } from "./testSupport/fakeEngine";
import { createManualClock } from "./testSupport/manualClock";

test("all sign-in viewers share polling and a change refreshes status and sources", async () => {
  let state: "signedIn" | "signedOut" = "signedIn";
  const fake = createFakeEngine({
    "tradeskillmaster.status": () => ({ state, account: null }),
  });
  const clock = createManualClock();
  let reloads = 0;
  const module = createTsmModule({
    rpc: fake.rpc,
    clock,
    reloadSources: async () => {
      reloads++;
    },
  });
  const off = module.status.subscribe("account", () => {});
  const off2 = module.status.subscribe("account", () => {});
  await module.status.refresh("account");
  expect(clock.activeTimers()).toBe(1);
  state = "signedOut";
  module.changed();
  await new Promise<void>((resolve) => {
    const off = module.status.subscribe("account", () => {
      if (module.status.get("account").data?.state === "signedOut") {
        off();
        resolve();
      }
    });
  });
  expect(module.status.get("account").data?.state).toBe("signedOut");
  expect(reloads).toBeGreaterThan(0);
  off();
  off2();
  expect(clock.activeTimers()).toBe(0);
});
