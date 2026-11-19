import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  BATTLE_NET_LAUNCH_TARGET,
  type BattleNetLaunchClient,
  type GameType,
  type Installation,
  type WowLaunchClient,
} from "../../api/contracts";
import { WOW_CLIENTS, wowClientForFolder } from "../clients";
import { readFlavorBuildInfo, type InstallationDetector } from "../installation/InstallationDetector";
import { isWowShortcut, shortcutPrefixOverrides } from "../installation/SteamShortcuts";
import { isWowClientExecutable, isWowLaunchExecutable } from "../installation/WowExecutables";
import { executableIcon, launcherIcon } from "./ExecutableIcon";
import type { LaunchEntry } from "./LaunchService";

const canonical = (path: string) => realpath(path).catch(() => undefined);

export async function resolveLaunchEntry(
  appId: number,
  installations: Installation[],
  steam: Pick<InstallationDetector, "steamLibraryFolders" | "steamShortcuts">,
  preferredId?: string,
): Promise<LaunchEntry | null> {
  const linked = installations.filter((i) => i.steamGames?.some((game) => game.appId === appId));
  if (!linked.length) return null;
  const [shortcuts, folders] = await Promise.all([
    steam.steamShortcuts(),
    steam.steamLibraryFolders(),
  ]);
  const descriptions = shortcuts.filter((shortcut) => shortcut.appId === appId);
  const shortcut = descriptions[0];
  if (
    !shortcut ||
    !isWowShortcut(shortcut) ||
    descriptions.some(
      (other) => other.exe !== shortcut.exe || other.launchOptions !== shortcut.launchOptions,
    )
  )
    return null;

  const exe = basename(
    shortcut.exe
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replaceAll("\\", "/"),
  );
  if (isWowClientExecutable(exe)) return null;

  const libraries = [
    ...new Set((await Promise.all(folders.map(canonical))).filter((lib) => lib !== undefined)),
  ];
  const overrides = shortcutPrefixOverrides(shortcut);
  const candidates = overrides.length
    ? overrides
    : libraries.map((lib) => join(lib, "steamapps", "compatdata", String(appId), "pfx"));
  const prefixes = [
    ...new Set(
      (await Promise.all(candidates.map(canonical))).filter((prefix) => prefix !== undefined),
    ),
  ];
  // A custom Wine prefix must still be the pfx used by Steam's replay.
  if (prefixes.length !== 1 || basename(prefixes[0]!) !== "pfx") return null;

  const paths = await Promise.all(
    linked.map(async (installation) => ({
      installation,
      path: await canonical(installation.path),
      root: await canonical(dirname(installation.path)),
    })),
  );
  const roots = new Set(paths.map(({ root }) => root));
  let ownedRoot = paths[0]?.root;
  if (roots.size > 1) {
    // Prefix discovery can link several registry roots to the same shortcut.
    // Use corroborating shortcut paths or matching Battle.net build records.
    const shortcutPaths = [shortcut.exe, ...descriptions.map((other) => other.startDir)];
    const locations = await Promise.all(shortcutPaths.map(async (raw) => {
      const path = raw.trim().replace(/^"(.*)"$/, "$1");
      if (!isAbsolute(path)) return;
      return canonical(isWowLaunchExecutable(basename(path)) ? dirname(path) : path);
    }));
    const evidence = await Promise.all(paths.map(async ({ installation, path, root }) => {
      if (!root) return;
      if (locations.includes(root)) return root;
      if (!path || dirname(path) !== root || basename(path) !== basename(installation.path)) return;
      return locations.includes(path) || await readFlavorBuildInfo(path) ? root : undefined;
    }));
    const owners = new Set(evidence.filter((root) => root !== undefined));
    if (owners.size !== 1) return null;
    [ownedRoot] = owners;
  }
  if (!ownedRoot) return null;

  const owned = paths.filter(({ root }) => root === ownedRoot);
  // A flavor alias must resolve to the registered flavor inside the chosen root.
  if (owned.some(({ installation, path }) =>
    path !== undefined && (dirname(path) !== ownedRoot || basename(path) !== basename(installation.path))
  )) return null;
  const present = owned.flatMap(({ installation, path }) => (path ? [{ installation, path }] : []));
  if (!present.length) return null;

  const wow = await Promise.all(
    present.map(async ({ installation, path }) => {
      const launch = clientLaunch(basename(path).toLowerCase(), installation.gameType);
      const icon = await executableIcon(path);
      const client: WowLaunchClient = {
        kind: "wow",
        id: installation.id,
        gameType: installation.gameType,
        name: installation.clientFullName,
        shortName: installation.clientName,
        launchable: "product" in launch,
        ...("reason" in launch && { reason: launch.reason }),
        ...(icon && { icon }),
      };
      return { client, path, product: "product" in launch ? launch.product : undefined, order: tableOrder(path) };
    }),
  );
  wow.sort((a, b) => a.order - b.order);

  const icon = await launcherIcon(unquote(shortcut.exe));
  const battleNet: BattleNetLaunchClient = {
    kind: "battlenet",
    id: BATTLE_NET_LAUNCH_TARGET,
    name: "Battle.net",
    shortName: "Battle.net",
    launchable: true,
    ...(icon && { icon }),
  };
  // A saved choice the entry no longer offers falls back to Battle.net.
  const chosen = wow.find(({ client }) => client.launchable && client.id === preferredId);
  return {
    appId,
    clients: [battleNet, ...wow.map(({ client }) => client)],
    target: chosen?.client ?? battleNet,
    ...(chosen && { targetDirectory: chosen.path, product: chosen.product }),
    prefixes,
    libraries,
  };
}

const unquote = (path: string) => path.trim().replace(/^"(.*)"$/, "$1");

/** Clients sort in client table order; a folder the table lacks sorts last. */
function tableOrder(path: string): number {
  const client = wowClientForFolder(basename(path).toLowerCase());
  const index = client ? WOW_CLIENTS.indexOf(client) : -1;
  return index < 0 ? WOW_CLIENTS.length : index;
}

/**
 * Whether Battle.net can start this client precisely, from the client
 * table's launch kind. Only an exact product code starts one client;
 * a version UID only selects the version in Battle.net.
 */
function clientLaunch(folder: string, gameType: GameType): { product: string } | { reason: string } {
  const client = wowClientForFolder(folder);
  const launch = client?.launch;
  if (launch?.kind === "version") {
    return { reason: "Battle.net can select this version. Press Play there to start it." };
  }
  if (launch?.kind === "product" && client!.gameType === gameType) {
    if (launch.exact) return { product: launch.code };
    return { reason: "Battle.net starts whichever Classic version you last selected there" };
  }
  return { reason: "WoWDeck has no launch command for this client" };
}
