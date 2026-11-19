import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Installation, LaunchClient } from "../../api/contracts";
import type { InstallationDetector } from "../installation/InstallationDetector";
import { isWowShortcut, shortcutPrefixOverrides } from "../installation/SteamShortcuts";
import { isWowClientExecutable } from "../installation/WowExecutables";
import { launchProducts } from "./LaunchProcesses";
import type { LaunchEntry } from "./LaunchService";

const canonical = (path: string) => realpath(path).catch(() => undefined);

export async function resolveLaunchEntry(
  appId: number,
  installations: Installation[],
  steam: Pick<InstallationDetector, "steamLibraryFolders" | "steamShortcuts">,
): Promise<LaunchEntry | null> {
  const linked = installations.filter((i) => i.steamGames?.some((game) => game.appId === appId));
  if (!linked.length) return null;
  const [shortcuts, folders] = await Promise.all([steam.steamShortcuts(), steam.steamLibraryFolders()]);
  const descriptions = shortcuts.filter((shortcut) => shortcut.appId === appId);
  const shortcut = descriptions[0];
  if (!shortcut || !isWowShortcut(shortcut) || descriptions.some((other) =>
    other.exe !== shortcut.exe || other.launchOptions !== shortcut.launchOptions)) return null;

  const exe = basename(shortcut.exe.trim().replace(/^"(.*)"$/, "$1").replaceAll("\\", "/"));
  if (isWowClientExecutable(exe)) return null;

  const libraries = [...new Set((await Promise.all(folders.map(canonical))).filter((lib) => lib !== undefined))];
  const overrides = shortcutPrefixOverrides(shortcut);
  const candidates = overrides.length ? overrides : libraries.map((lib) => join(lib, "steamapps", "compatdata", String(appId), "pfx"));
  const prefixes = [...new Set((await Promise.all(candidates.map(canonical))).filter((prefix) => prefix !== undefined))];
  // A custom Wine prefix must still be the pfx used by Steam's replay.
  if (prefixes.length !== 1 || basename(prefixes[0]!) !== "pfx") return null;

  const paths = await Promise.all(linked.map(async (installation) => ({
    installation, path: await canonical(installation.path),
  })));
  const present = paths.filter((item) => item.path !== undefined);
  if (new Set(present.map((item) => dirname(item.path!))).size !== 1) return null;

  const clients: LaunchClient[] = present.map(({ installation }) => ({
    installationId: installation.id,
    gameType: installation.gameType,
    name: installation.clientName,
    launchable: launchProducts[installation.gameType] !== undefined,
  }));
  const requested = /--exec(?:=|\s+)(?:["'])?launch\s+([^\s"']+)/i.exec(shortcut.launchOptions)?.[1]?.toLowerCase();
  const selected = present.findIndex(({ installation }) => installation.selected);
  const launchOption = clients.findIndex((client) => requested && launchProducts[client.gameType]?.toLowerCase() === requested);
  const targetIndex = launchOption >= 0 ? launchOption : selected >= 0 ? selected : clients.findIndex((client) => client.launchable);
  const index = Math.max(0, targetIndex);
  return { appId, clients, target: clients[index]!, targetDirectory: present[index]!.path!, prefixes, libraries };
}
