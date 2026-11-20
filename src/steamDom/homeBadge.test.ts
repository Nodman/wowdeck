import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { LinkedGames } from "../../backend/src/api/contracts";
import { defaultSettings } from "../../backend/src/wow/storage/settings";
import { connectEngine } from "../engineLink";
import { createFakeEngine, type FakeEngine } from "../testSupport/fakeEngine";

// Steam's window, holding the library with linked app 42's tile.
let dom: JSDOM;
mock.module("@decky/ui", () => ({ findSP: () => dom.window }));
mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));

const { startHomeBadge } = await import("./homeBadge");
const { settingsStore } = await import("../settings");
const { linkedGamesStore } = await import("../linkedGames");

const WOW = { appId: 42, name: "World of Warcraft", source: "found" } as const;
let fake: FakeEngine;
let disconnect: () => void;
let stop: () => void;

beforeEach(() => {
  jest.useFakeTimers();
  dom = new JSDOM(
    '<div class="tile"><img src="https://steamloopback.host/customimages/42.png"></div>',
  );
  (globalThis as { MutationObserver?: unknown }).MutationObserver = dom.window.MutationObserver;
  // JSDOM lays nothing out: the tile and its image share one tile-sized box.
  dom.window.HTMLElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 113, height: 170 }) as DOMRect;
  fake = createFakeEngine({
    "addons.updateSummary": {
      installations: [{ installationId: "r", displayName: "Retail", updates: 2 }],
    },
  });
  disconnect = connectEngine(fake);
});

afterEach(() => {
  stop();
  disconnect();
  dom.window.close();
  delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
  jest.useRealTimers();
});

/** Let the badge's coalesced pass run, and the summary it asks for land. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    jest.advanceTimersByTime(250);
    for (let j = 0; j < 10; j++) await Promise.resolve();
  }
}
const badge = () => dom.window.document.querySelector(".wowdeck-tile-badge");

async function load(linked: LinkedGames) {
  const settings = settingsStore.load();
  fake.next("settings.get").resolve({ settings: { ...defaultSettings(), steamAutoCheck: false } });
  await settings;
  const games = linkedGamesStore.load();
  fake.next("linkedGames.get").resolve(linked);
  await games;
}

test("the badge draws nothing, and starts no check, until the settings and the linked games have loaded", async () => {
  stop = startHomeBadge();
  await settle();
  expect(badge()).toBeNull();
  expect(fake.paramsOf("addons.updateSummary")).toEqual([]);

  await load({ enabled: true, games: [WOW] });
  await settle();
  expect(badge()?.getAttribute("aria-label")).toBe("WoW addon updates available");
});

test("Show in Steam off removes the badge", async () => {
  stop = startHomeBadge();
  await load({ enabled: true, games: [WOW] });
  await settle();
  expect(badge()).not.toBeNull();
  fake.emit({ event: "linkedGames.changed", params: { enabled: false, games: [WOW] } });
  await settle();
  expect(badge()).toBeNull();
});
