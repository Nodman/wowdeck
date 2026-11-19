import { describe, expect, test } from "bun:test";
import type { LaunchState } from "../backend/src/api/contracts";
import { createEventRouter } from "./engineLink";
import { createLaunchActions, launchControl } from "./steamLaunch";
import { createFakeEngine } from "./testSupport/fakeEngine";

const target = {
  name: "Forever",
  installationId: "forever",
  gameType: "forever",
  launchable: true,
} as const;
const ready: LaunchState = {
  target,
  clients: [target],
  busy: false,
  entryRunning: true,
  gameRunning: "not_running",
};

describe("the linked game page launch control", () => {
  test("uses the engine's busy state and explains why a running client disables launch", async () => {
    const fake = createFakeEngine({
      "launch.state": { state: ready },
      "launch.start": { state: { ...ready, busy: true } },
    });
    const actions = createLaunchActions(fake.rpc, createEventRouter(), () => {});
    expect(launchControl(await actions.state(42))).toEqual({ label: "Forever", reason: null });
    expect(launchControl(await actions.start(42))).toEqual({
      label: "Forever",
      reason: "Starting…",
    });
    fake.answers["launch.state"] = { state: { ...ready, gameRunning: "running" } };
    expect(launchControl(await actions.state(42))).toEqual({
      label: "Forever",
      reason: "WoW is already running",
    });
    expect(fake.paramsOf("launch.start")).toEqual([{ appId: 42 }]);
  });

  test("a failure emits one toast from the engine event while a refusal is silent", async () => {
    const fake = createFakeEngine({
      "launch.state": { state: ready },
      "launch.start": { state: { ...ready, busy: true } },
    });
    const events = createEventRouter();
    fake.subscribe(events.dispatch);
    const titles: string[] = [];
    const actions = createLaunchActions(fake.rpc, events, (title) => titles.push(title));
    await actions.start(42);
    fake.emit({
      event: "launch.completed",
      params: { appId: 42, clientName: "Forever", outcome: "never-ready" },
    });
    fake.emit({
      event: "launch.completed",
      params: { appId: 42, clientName: "Forever", outcome: "unconfirmed" },
    });
    expect(titles).toEqual(["Couldn't launch Forever"]);
    expect(launchControl(await actions.state(42))?.reason).toBeNull();
  });
});

test("uses the string shortcut game ID and reports an explicit Steam refusal once", async () => {
  const stopped = { ...ready, entryRunning: false };
  const fake = createFakeEngine({
    "launch.start": {
      state: { ...stopped, busy: true },
      steamStart: { gameId: "18130714796645941248", attemptId: "attempt" },
    },
    "launch.steamRefused": () => undefined,
  });
  const events = createEventRouter();
  fake.subscribe(events.dispatch);
  const launches: string[] = [];
  const toasts: string[] = [];
  let showError: ((gameId: string, action: string) => void) | undefined;
  const actions = createLaunchActions(fake.rpc, events, (_title, body) => toasts.push(body), {
    getRunGame: () => (gameId) => {
      launches.push(gameId);
    },
    onError(handler) {
      showError = handler;
      return () => {
        showError = undefined;
      };
    },
  });
  expect(launchControl(stopped, false)?.reason).toBe("Steam launch is unavailable");
  expect(launchControl(stopped, true)?.reason).toBeNull();
  await actions.start(4221385996);
  expect(launches).toEqual(["18130714796645941248"]);
  expect(fake.paramsOf("launch.steamRefused")).toEqual([]);
  showError?.("another entry", "LaunchApp");
  showError?.("18130714796645941248", "VerifyApp");
  expect(fake.paramsOf("launch.steamRefused")).toEqual([]);
  showError?.("18130714796645941248", "LaunchApp");
  showError?.("18130714796645941248", "LaunchApp");
  expect(fake.paramsOf("launch.steamRefused")).toEqual([{ attemptId: "attempt" }]);
  fake.emit({
    event: "launch.completed",
    params: { appId: 4221385996, clientName: "Forever", outcome: "steam-refused" },
  });
  expect(showError).toBeUndefined();
  expect(toasts).toEqual(["Steam couldn’t start the library entry"]);
});

test("an already-running entry works without Steam's start API", async () => {
  const fake = createFakeEngine({ "launch.start": { state: { ...ready, busy: true } } });
  const actions = createLaunchActions(fake.rpc, createEventRouter(), () => {});
  expect(launchControl(ready, actions.canStartSteam())?.reason).toBeNull();
  expect((await actions.start(42))?.busy).toBe(true);
  expect(fake.paramsOf("launch.start")).toEqual([{ appId: 42 }]);
});
