import { expect, test } from "bun:test";
import { LaunchService, type LaunchEntry, type LaunchWorld } from "../src/wow/launch/LaunchService";
import type { LaunchCompletion } from "../src/api/contracts";

function fixture(appId = 123) {
  let now = 0;
  let next: (() => void) | undefined;
  const asks: number[] = [];
  const results: LaunchCompletion[] = [];
  const observation = { entryRunning: true, renderer: null as number | null, gameRunning: "not_running" as const, targetRunning: false };
  const world: LaunchWorld = {
    now: () => now,
    wait: () => new Promise<void>((resolve) => { next = resolve; }),
    observe: async () => ({ ...observation }),
    ask: async () => { asks.push(now); return true; },
  };
  const client = { installationId: "forever", name: "Forever", gameType: "forever", launchable: true } as const;
  const entry: LaunchEntry = {
    appId,
    clients: [client],
    target: client,
    targetDirectory: "/games/wow/_forever_",
    prefixes: ["/steam/steamapps/compatdata/123/pfx"],
    libraries: ["/steam"],
  };
  const service = new LaunchService(async () => entry, world, (result) => results.push(result));
  return {
    service, observation, asks, results, world,
    async at(ms: number) {
      now = ms;
      next?.();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    },
  };
}

test("a late renderer gets three asks at fifteen-second intervals inside the window", async () => {
  const f = fixture();
  expect((await f.service.start(123)).state?.busy).toBe(true);
  await f.at(100_000);
  f.observation.renderer = 11;
  await f.at(110_000);
  await f.at(114_999);
  expect(f.asks).toEqual([]);
  await f.at(115_000);
  await f.at(130_000);
  await f.at(145_000);
  await f.at(149_999);
  expect(f.asks).toEqual([115_000, 130_000, 145_000]);
  await f.at(150_000);
  expect(f.results.map((result) => result.outcome)).toEqual(["unconfirmed"]);
  expect((await f.service.state(123))?.busy).toBe(false);
});

test("a launcher that never draws a renderer ends with one readiness failure", async () => {
  const f = fixture();
  await f.service.start(123);
  await f.at(150_000);
  expect(f.asks).toEqual([]);
  expect(f.results.map((result) => result.outcome)).toEqual(["never-ready"]);
});

test("a duplicate press shares the attempt and stops asking when the target is seen", async () => {
  const f = fixture();
  f.observation.renderer = 11;
  await Promise.all([f.service.start(123), f.service.start(123)]);
  await f.at(15_000);
  f.observation.targetRunning = true;
  await f.at(16_000);
  expect(f.asks).toEqual([15_000]);
  expect(f.results.map((result) => result.outcome)).toEqual(["confirmed"]);
});

test("a failure to create the ask ends the attempt", async () => {
  const f = fixture();
  f.observation.renderer = 11;
  f.world.ask = async () => false;
  await f.service.start(123);
  await f.at(15_000);
  expect(f.results.map((result) => result.outcome)).toEqual(["ask-failed"]);
});

test("one press from rest grants Steam a single start and keeps the attempt alive until WoW appears", async () => {
  const appId = 4221385996;
  const f = fixture(appId);
  f.observation.entryRunning = false;
  expect((await f.service.start(appId))?.state?.busy).toBe(false);
  const presses = await Promise.all([f.service.start(appId, true), f.service.start(appId, true)]);
  expect(presses.every((press) => press?.state?.busy)).toBe(true);
  expect(presses.flatMap((press) => press?.steamStart ? [press.steamStart.gameId] : [])).toEqual(["18130714796645941248"]);
  await f.at(2_000);
  expect(f.asks).toEqual([]);
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  await f.at(6_000);
  await f.at(21_000);
  f.observation.targetRunning = true;
  await f.at(22_000);
  expect(f.asks).toEqual([21_000]);
  expect(f.results.map((result) => result.outcome)).toEqual(["confirmed"]);
});

test("a matching Steam refusal ends the attempt exactly once without sending an ask", async () => {
  const f = fixture();
  f.observation.entryRunning = false;
  const { steamStart } = await f.service.start(123, true);
  expect(steamStart).toBeDefined();
  f.service.steamRefused("another attempt");
  await f.at(1_000);
  expect(f.results).toEqual([]);
  f.service.steamRefused(steamStart!.attemptId);
  f.service.steamRefused(steamStart!.attemptId);
  await f.at(2_000);
  expect(f.asks).toEqual([]);
  expect(f.results.map((result) => result.outcome)).toEqual(["steam-refused"]);
  expect((await f.service.state(123))?.busy).toBe(false);
});

test("Steam Play already starting the entry never receives a second Steam start", async () => {
  const f = fixture();
  f.observation.entryRunning = false;
  const press = await f.service.start(123, true, true);
  expect(press.steamStart).toBeUndefined();
  expect(press.state?.busy).toBe(true);
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  await f.at(5_000);
  await f.at(15_000);
  expect(f.asks).toEqual([15_000]);
});

test("Steam silence without a session or explicit error produces no refusal", async () => {
  const f = fixture();
  f.observation.entryRunning = false;
  await f.service.start(123, true);
  await f.at(150_000);
  expect(f.asks).toEqual([]);
  expect(f.results.map((result) => result.outcome)).toEqual(["unconfirmed"]);
});
