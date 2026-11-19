/**
 * The `launch.*` methods on the real engine, assembled in-process over a
 * recorded Steam shortcut and a WoW root, with fake processes in place of
 * the machine's.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LaunchCompletion } from "../src/api/contracts";
import { configFromEnv, startEngine, type Engine } from "../src/engine";
import type { LaunchWorld, Observation } from "../src/wow/launch/LaunchService";
import { BMP, syntheticPe } from "./helpers/syntheticPe";
import { loadCassette, ReplayNetwork } from "./providers/cassette";

const APP_ID = 42;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Synthetic binary KeyValues shortcuts.vdf with one non-Steam shortcut. */
function writeShortcut(steam: string, exe: string) {
  const string = (key: string, value: string) => Buffer.from(`\x01${key}\0${value}\0`);
  const appid = Buffer.alloc(4);
  appid.writeUInt32LE(APP_ID);
  const record = Buffer.concat([
    Buffer.from("\x000\0\x02appid\0"),
    appid,
    string("AppName", "World of Warcraft"),
    string("Exe", `"${exe}"`),
    string("StartDir", ""),
    string("LaunchOptions", ""),
    Buffer.from([8]),
  ]);
  const config = join(steam, "userdata/100/config");
  mkdirSync(config, { recursive: true });
  writeFileSync(
    join(config, "shortcuts.vdf"),
    Buffer.concat([Buffer.from("\0shortcuts\0"), record, Buffer.from([8, 8])]),
  );
}

interface Setup {
  /** The shortcut's executable, relative to the WoW root. */
  exe?: string;
  /** Bytes of the launcher executable; empty when unset. */
  launcher?: Uint8Array;
  /** Reuse an earlier fixture's home and data (an engine restart). */
  root?: string;
}

/** A WoW root with Retail, Classic and Forever, linked to one Battle.net shortcut. */
async function fixture(setup: Setup = {}) {
  const root = setup.root ?? mkdtempSync(join(tmpdir(), "wowdeck-launch-engine-"));
  if (!setup.root) roots.push(root);
  const home = join(root, "home");
  const steam = join(home, ".local/share/Steam");
  const wow = join(home, "Games/World of Warcraft");
  for (const [flavor, exe] of [["_retail_", "Wow.exe"], ["_classic_", "WowClassic.exe"], ["_forever_", "Wow.exe"]]) {
    mkdirSync(join(wow, flavor!), { recursive: true });
    writeFileSync(join(wow, flavor!, exe!), "");
  }
  writeFileSync(join(wow, "Battle.net Launcher.exe"), setup.launcher ?? "");
  mkdirSync(join(steam, "steamapps/compatdata", String(APP_ID), "pfx"), { recursive: true });
  writeShortcut(steam, join(wow, setup.exe ?? "Battle.net Launcher.exe"));

  let now = 0;
  let tick: (() => void) | undefined;
  const asks: number[] = [];
  const observation: Observation = {
    entryRunning: false, renderer: null, gameRunning: "not_running", targetRunning: false,
  };
  const world: LaunchWorld = {
    now: () => now,
    wait: () => new Promise<void>((resolve) => { tick = resolve; }),
    observe: async () => ({ ...observation }),
    ask: async () => {
      asks.push(now);
      return { startupFailed: Promise.resolve(false) };
    },
  };
  const completions: LaunchCompletion[] = [];
  const out = (line: string) => {
    const message = JSON.parse(line) as { event?: string; params?: LaunchCompletion };
    if (message.event === "launch.completed") completions.push(message.params!);
  };
  const base = configFromEnv({ HOME: home, WOWDECK_DATA_DIR: join(root, "data") }, "9.9.9");
  const engine: Engine = await startEngine({
    ...base,
    network: new ReplayNetwork(await loadCassette("wowup-hub")),
    now: () => Date.UTC(2026, 10, 1),
    out,
    launchWorld: world,
  });
  const { installations } = await engine.call("installations.list", {});
  // A direct client shortcut discovers its own flavor only.
  const id = (flavor: string) => installations.find((i) => i.path.endsWith(flavor))?.id ?? "";
  return {
    root, engine, observation, asks, completions,
    retail: id("_retail_"), classic: id("_classic_"), forever: id("_forever_"),
    selected: async () =>
      (await engine.call("installations.list", {})).installations.find((i) => i.selected)?.id,
    state: async () => (await engine.call("launch.state", { appId: APP_ID })).state,
    icon: async (targetId: string) =>
      (await engine.call("launch.icon", { appId: APP_ID, targetId })).icon,
    select: (targetId: string) => engine.call("launch.select", { appId: APP_ID, targetId }),
    start: (canStartSteam = true) => engine.call("launch.start", { appId: APP_ID, canStartSteam }),
    async at(ms: number) {
      now = ms;
      tick?.();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    },
  };
}

test("Battle.net is the default target and leads the clients in client table order", async () => {
  const f = await fixture();
  const state = await f.state();
  expect(state?.target).toMatchObject({ kind: "battlenet", id: "battlenet", launchable: true });
  expect(state?.clients.map(({ kind, id, name, shortName, launchable }) => ({ kind, id, name, shortName, launchable }))).toEqual([
    { kind: "battlenet", id: "battlenet", name: "Battle.net", shortName: "Battle.net", launchable: true },
    { kind: "wow", id: f.retail, name: "World of Warcraft", shortName: "Retail", launchable: true },
    { kind: "wow", id: f.classic, name: "Mists of Pandaria Classic", shortName: "Classic", launchable: false },
    { kind: "wow", id: f.forever, name: "World of Warcraft: Forever", shortName: "Forever", launchable: true },
  ]);
});

test("a chosen client becomes the active installation; Battle.net leaves it alone", async () => {
  const f = await fixture();
  expect((await f.select(f.forever)).target).toMatchObject({ kind: "wow", id: f.forever });
  expect(await f.selected()).toBe(f.forever);
  expect((await f.state())?.target.id).toBe(f.forever);

  expect((await f.select("battlenet")).target.kind).toBe("battlenet");
  expect(await f.selected()).toBe(f.forever);
  expect((await f.state())?.target.kind).toBe("battlenet");
});

test("a saved choice survives an engine restart", async () => {
  const first = await fixture();
  await first.select(first.forever);
  const again = await fixture({ root: first.root });
  expect((await again.state())?.target).toMatchObject({ kind: "wow", id: first.forever, shortName: "Forever" });
});

test("a choice saved by #284's picker still resolves", async () => {
  const first = await fixture();
  // #284's launch.select wrote the installation id under the shortcut's app id,
  // together with the active installation.
  const file = join(first.root, "data/state.json");
  const saved = JSON.parse(readFileSync(file, "utf8")) as { settings: Record<string, unknown> };
  saved.settings.selectedInstallationId = first.forever;
  saved.settings.steamLaunchTargets = { [String(APP_ID)]: first.forever };
  writeFileSync(file, JSON.stringify(saved));

  const again = await fixture({ root: first.root });
  expect((await again.state())?.target).toMatchObject({
    kind: "wow", id: first.forever, shortName: "Forever", launchable: true,
  });
});

test("a client Battle.net can't start precisely, or one the entry doesn't offer, can't be chosen", async () => {
  const f = await fixture();
  await f.select(f.retail);
  await expect(f.select(f.classic)).rejects.toThrow();
  await expect(f.select("elsewhere")).rejects.toThrow();
  expect((await f.state())?.clients.find((client) => client.id === f.classic)?.reason)
    .toBe("Battle.net starts whichever Classic version you last selected there");
  expect(await f.selected()).toBe(f.retail);
});

test("starting Battle.net starts the Steam entry and never sends a launch ask", async () => {
  const f = await fixture();
  const { state, steamStart } = await f.start();
  expect(state?.busy).toBe(true);
  expect(steamStart?.gameId).toBe(((42n << 32n) | 0x02000000n).toString());
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  for (const ms of [5_000, 20_000, 35_000]) await f.at(ms);
  expect(f.asks).toEqual([]);
  expect(f.completions).toEqual([{ appId: APP_ID, clientName: "Battle.net", outcome: "confirmed" }]);

  // Battle.net already open: nothing more to start.
  expect(await f.start()).toEqual({ state: expect.objectContaining({ busy: false }) });
});

test("a Steam refusal of a Battle.net start is reported", async () => {
  const f = await fixture();
  const { steamStart } = await f.start();
  await f.engine.call("launch.steamRefused", { attemptId: steamStart!.attemptId });
  await f.at(1_000);
  expect(f.completions).toEqual([{ appId: APP_ID, clientName: "Battle.net", outcome: "steam-refused" }]);
});

test("starting a chosen client asks Battle.net once it is ready and names the client on completion", async () => {
  const f = await fixture();
  await f.select(f.forever);
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  expect((await f.start()).steamStart).toBeUndefined();
  await f.at(15_000);
  expect(f.asks).toEqual([15_000]);
  f.observation.targetRunning = true;
  await f.at(16_000);
  expect(f.completions).toEqual([{ appId: APP_ID, clientName: "Forever", outcome: "confirmed" }]);
});

test("a shortcut that starts a WoW client executable directly gets no launch state", async () => {
  const f = await fixture({ exe: "_retail_/Wow.exe" });
  expect(await f.state()).toBeNull();
  expect((await f.start()).state).toBeNull();
  await expect(f.select("battlenet")).rejects.toThrow();
});

test("icons come one client at a time, never in the polled state", async () => {
  const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
  const withIcon = await fixture({ launcher: pe });
  expect(JSON.stringify(await withIcon.state())).not.toContain("data:");
  expect(await withIcon.icon("battlenet")).toStartWith("data:image/x-icon;base64,");
  // The fixture's client executables are empty: WoWDeck's glyph.
  expect(await withIcon.icon(withIcon.forever)).toBeNull();
  expect(await withIcon.icon("no-such-client")).toBeNull();
  expect(await withIcon.icon("constructor")).toBeNull();

  const unreadable = await fixture({ launcher: new TextEncoder().encode("MZ") });
  expect(await unreadable.icon("battlenet")).toBeNull();
});

test("a client's icon is read from that client's executable", async () => {
  const f = await fixture();
  const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
  writeFileSync(join(f.root, "home/Games/World of Warcraft/_forever_/Wow.exe"), pe);
  expect(await f.icon(f.forever)).toStartWith("data:image/x-icon;base64,");
  expect(await f.icon(f.retail)).toBeNull();
});
