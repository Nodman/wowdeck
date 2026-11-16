import { test, expect } from "bun:test";
import { startTsmSignIn } from "./tsmSignIn";
import { createFakeEngine } from "./testSupport/fakeEngine";
import type { TradeSkillMasterAuthStatus } from "../backend/src/api/contracts";

function harness(states: TradeSkillMasterAuthStatus["state"][]) {
  const opened: string[] = [];
  let closed = 0;
  let tick: (() => void) | undefined;
  const { rpc } = createFakeEngine({
    "tradeskillmaster.signIn": { authorizeUrl: "https://fixture.invalid/authorize" },
    "tradeskillmaster.status": () => ({ state: states.shift()!, account: null }),
  });
  const browser = { open: (url: string) => opened.push(url), close: () => closed++ };
  const clock = {
    setInterval: (fn: () => void) => ((tick = fn), 1),
    clearInterval: () => (tick = undefined),
  };
  const step = async () => {
    tick?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { rpc, browser, clock, opened, closed: () => closed, step, watching: () => !!tick };
}

test("sign-in opens the authorize URL and closes the browser once signed in", async () => {
  const h = harness(["signingIn", "signedIn"]);
  await startTsmSignIn(h.rpc, h.browser, h.clock);
  expect(h.opened).toEqual(["https://fixture.invalid/authorize"]);
  await h.step();
  expect(h.closed()).toBe(0);
  await h.step();
  expect(h.closed()).toBe(1);
  expect(h.watching()).toBe(false);
});

test("a cancelled sign-in leaves the browser alone", async () => {
  const h = harness(["off"]);
  await startTsmSignIn(h.rpc, h.browser, h.clock);
  await h.step();
  expect(h.closed()).toBe(0);
  expect(h.watching()).toBe(false);
});
