import { expect, test } from "bun:test";
import { observeLaunch, type LaunchProcess } from "../src/wow/launch/LaunchProcesses";
import type { LaunchEntry } from "../src/wow/launch/LaunchService";

const home = "/home/deck";
const steam = home + "/.local/share/Steam";
const prefix = steam + "/steamapps/compatdata/123/pfx";
const runtime = steam + "/steamapps/common/SteamLinuxRuntime_4/_v2-entry-point";
const proton = steam + "/compatibilitytools.d/GE-Proton/proton";
const battle = prefix + "/drive_c/Program Files (x86)/Battle.net/Battle.net.exe";
const reaper = steam + "/steamrt64/reaper";
const target = { installationId: "forever", name: "Forever", gameType: "forever", launchable: true } as const;
const entry: LaunchEntry = {
  appId: 123, clients: [target], target, targetDirectory: "/games/wow/_forever_",
  prefixes: [prefix], libraries: [steam],
};
const launcher: LaunchProcess = {
  pid: 1, executable: reaper,
  argv: [reaper, "SteamLaunch", "--", runtime, "--verb=waitforexitandrun", "--", proton, "waitforexitandrun", battle, "--exec=launch WoW", "--other"],
  env: new Map([
    ["STEAM_COMPAT_DATA_PATH", prefix.slice(0, -4)],
    ["STEAM_COMPAT_TOOL_PATHS", [proton.slice(0, -7), runtime.slice(0, runtime.lastIndexOf("/"))].join(":")],
    ["LD_PRELOAD", "bad"], ["SECRET_TOKEN", "private"], ["HOME", home],
  ]),
};
const renderer: LaunchProcess = {
  pid: 2, executable: proton.replace(/\/proton$/, "/files/lib/wine/i386-unix/wine-preloader"),
  argv: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.exe", "--type=renderer"],
  env: new Map([["WINEPREFIX", prefix]]),
};
const observe = (processes: LaunchProcess[]) => observeLaunch(entry, processes, [steam], home, async (path) => path);

test("replay builds a fresh argv for the approved launcher and drops inherited options", async () => {
  const result = await observe([launcher, renderer]);
  expect(result.renderer).toBe(2);
  expect(result.replay?.argv).toEqual([runtime, "--verb=run", "--", proton, "run", battle, "--exec=launch WoWF"]);
  expect(result.replay?.env).not.toHaveProperty("LD_PRELOAD");
  expect(result.replay?.env).not.toHaveProperty("SECRET_TOKEN");
});

test("other prefixes, an untrusted runtime path and a different install cannot authorize an ask", async () => {
  const foreign = { ...renderer, env: new Map([["WINEPREFIX", "/other/pfx"]]) };
  expect((await observe([launcher, foreign])).renderer).toBeNull();
  expect((await observe([{ ...launcher, argv: launcher.argv.map(arg => arg === runtime ? "/tmp/_v2-entry-point" : arg) }, renderer])).replay).toBeUndefined();
  const otherWow = { ...renderer, argv: ["Z:\\other\\_forever_\\Wow.exe"] };
  expect(await observe([launcher, renderer, otherWow])).toMatchObject({ targetRunning: false, gameRunning: "running" });
});

test("a Steam reaper for a different shortcut cannot replay into a shared prefix", async () => {
  const shared = { ...launcher, env: new Map([...launcher.env, ["SteamAppId", "456"]]) };
  expect((await observe([shared, renderer])).replay).toBeUndefined();
});

test("a replay can be released only when the original launcher and its prefix are idle", async () => {
  const { replayCanStop } = await import("../src/wow/launch/LaunchProcesses");
  const plan = (await observe([launcher, renderer])).replay!;
  const samePrefixWow = { ...renderer, argv: ["Z:\\games\\wow\\_forever_\\Wow.exe"] };
  expect(await replayCanStop(plan, [launcher], async (path) => path)).toBe(false);
  expect(await replayCanStop(plan, [renderer], async (path) => path)).toBe(false);
  expect(await replayCanStop(plan, [samePrefixWow], async (path) => path)).toBe(false);
  expect(await replayCanStop(plan, null, async (path) => path)).toBe(false);
  expect(await replayCanStop(plan, [], async (path) => path)).toBe(true);
});
