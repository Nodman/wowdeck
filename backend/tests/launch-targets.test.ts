import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Installation } from "../src/api/contracts";
import { resolveLaunchEntry } from "../src/wow/launch/LaunchEntries";

async function fixture(
  run: (setup: {
    root: string;
    shortcut: { exe: string; startDir: string };
    add: (
      root: string,
      folder: string,
      gameType: Installation["gameType"],
      linked?: boolean,
    ) => Promise<Installation>;
    resolve: (selected?: string) => ReturnType<typeof resolveLaunchEntry>;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "wowdeck-launch-targets-"));
  const installs: Installation[] = [];
  const shortcut = {
    appId: 42,
    exe: "Battle.net.exe",
    startDir: "",
    launchOptions: '--exec="launch WoWF"',
  };
  const steam = {
    steamShortcuts: async () => [shortcut],
    steamLibraryFolders: async () => [root],
  };
  try {
    await mkdir(join(root, "steamapps/compatdata/42/pfx"), { recursive: true });
    await run({
      root,
      shortcut,
      async add(parent, folder, gameType, linked = true) {
        const path = join(parent, folder);
        await mkdir(path, { recursive: true });
        const installation: Installation = {
          id: path,
          path,
          gameType,
          clientName: gameType,
          displayName: gameType,
          clientFullName: gameType,
          addonsPath: join(path, "Interface/AddOns"),
          selected: false,
          source: "detected",
          hidden: false,
          autoUpdateEnabled: true,
          version: null,
          steamGames: linked ? [{ appId: 42, name: "WoW" }] : [],
        };
        installs.push(installation);
        return installation;
      },
      resolve: (selected) => resolveLaunchEntry(42, installs, steam, selected),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Battle.net stays the target, even with a shortcut product option, until a linked client is remembered", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const wow = join(root, "WoW");
    const retail = await add(wow, "_retail_", "retail");
    const forever = await add(wow, "_forever_", "forever");
    const unrelated = await add(join(root, "other"), "_retail_", "retail", false);
    expect(await resolve()).toMatchObject({ target: { kind: "battlenet" } });
    expect((await resolve())?.targetDirectory).toBeUndefined();
    expect(await resolve(retail.id)).toMatchObject({ targetDirectory: retail.path, product: "WoW" });
    expect((await resolve(unrelated.id))?.clients.map((client) => client.id)).toEqual([
      "battlenet",
      retail.id,
      forever.id,
    ]);
    expect((await resolve(unrelated.id))?.target.kind).toBe("battlenet");
  });
});

test("clients follow client table order, not discovery order", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const forever = await add(root, "_forever_", "forever");
    const era = await add(root, "_classic_era_", "classic_era");
    const retail = await add(root, "_retail_", "retail");
    expect((await resolve())?.clients.map((client) => client.id)).toEqual([
      "battlenet", retail.id, era.id, forever.id,
    ]);
  });
});

test("a product token and a remembered target cannot disambiguate two linked roots", async () => {
  await fixture(async ({ root, add, resolve }) => {
    await add(join(root, "WoW"), "_retail_", "retail");
    const other = await add(join(root, "other"), "_forever_", "forever");
    expect(await resolve(other.id)).toBeNull();
  });
});

test("even a sole linked client cannot escape its registered root through a symlink", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const wow = join(root, "WoW");
    const classic = await add(wow, "_classic_", "classic");
    const outside = await add(join(root, "other"), "_classic_", "classic", false);
    await rm(classic.path, { recursive: true });
    await symlink(outside.path, classic.path);
    expect(await resolve()).toBeNull();
  });
});

test("a Classic product and version-only clients explain why they cannot start precisely", async () => {
  await fixture(async ({ root, add, resolve }) => {
    await add(root, "_classic_", "classic");
    await add(root, "_classic_era_", "classic_era");
    expect((await resolve())?.clients).toMatchObject([
      { kind: "battlenet", launchable: true },
      {
        launchable: false,
        reason: "Battle.net starts whichever Classic version you last selected there",
      },
      {
        launchable: false,
        reason: "Battle.net can select this version. Press Play there to start it.",
      },
    ]);
  });
});

async function markBattleNet(installation: Installation, product: string) {
  await writeFile(join(installation.path, ".flavor.info"), `Flavor!STRING:0\n${product}\n`);
  await writeFile(join(dirname(installation.path), ".build.info"), `Product!STRING:0|Version!STRING:0\n${product}|1.2.3\n`);
}

test("a Battle.net build record identifies the linked root even when another root also has the requested flavor", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const wow = join(root, "WoW");
    const retail = await add(wow, "_retail_", "retail");
    const forever = await add(wow, "_forever_", "forever");
    const unrelated = await add(join(root, "other"), "_forever_", "forever");
    await markBattleNet(forever, "wowf");
    expect((await resolve(unrelated.id))?.clients.map((client) => client.id)).toEqual([
      "battlenet", retail.id, forever.id,
    ]);
    expect((await resolve(forever.id))?.target.id).toBe(forever.id);

    await markBattleNet(unrelated, "wowf");
    expect(await resolve()).toBeNull();
  });
});

test("a shortcut path can identify a linked root, but conflicting evidence leaves it ambiguous", async () => {
  await fixture(async ({ root, shortcut, add, resolve }) => {
    const wow = join(root, "WoW");
    const forever = await add(wow, "_forever_", "forever");
    const other = await add(join(root, "other"), "_retail_", "retail");
    shortcut.startDir = `"${wow}"`;
    expect((await resolve())?.clients.map((client) => client.id)).toEqual(["battlenet", forever.id]);

    await markBattleNet(other, "wow");
    expect(await resolve()).toBeNull();

    shortcut.startDir = "";
    shortcut.exe = join(wow, "World of Warcraft Launcher.exe");
    await writeFile(shortcut.exe, "");
    expect(await resolve()).toBeNull();
  });
});
