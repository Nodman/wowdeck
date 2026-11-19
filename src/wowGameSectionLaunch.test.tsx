import { expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine } from "./testSupport/fakeEngine";

mock.module("@decky/ui", () => ({ ...deckyUiStub, QuickAccessTab: {} }));
mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));

const { WowGameSection } = await import("./components/WowGameSection");
const { settingsStore } = await import("./settings");

test("a linked page offers Retry for a failed launch read", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const env = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
  const oldWindow = env.window;
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  const fake = createFakeEngine({
    "addons.updateSummary": { installations: [] },
    "settings.get": {
      settings: {
        ...defaultSettings(),
        steamGame: { appId: 42, name: "WoW" },
        steamAutoCheck: false,
      },
    },
  });
  const disconnect = connectEngine(fake);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const addonSection = () => container.querySelector(".wowdeck-game-section")!;
  const retry = () =>
    [...addonSection().querySelectorAll("button")].find((button) => button.textContent === "Retry");

  try {
    await settingsStore.load();
    await act(async () => {
      root.render(<WowGameSection appId={42} attachLaunch={() => {}} />);
    });
    await act(async () => fake.next("launch.state").fail(new Error("bridge disconnected")));
    expect(addonSection().textContent).toContain("Couldn't check WoW launch status");
    expect(retry()?.disabled).toBe(false);
    await act(async () => retry()?.click());
    expect(retry()?.disabled).toBe(true);
    await act(async () => fake.next("launch.state").resolve({ state: null }));
    expect(retry()).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    disconnect();
    dom.window.close();
    env.window = oldWindow;
    delete env.IS_REACT_ACT_ENVIRONMENT;
  }
});
