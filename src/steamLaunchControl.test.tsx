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

const { SteamLaunchActionRow } = await import("./components/SteamLaunchControl");
const { WowGameSection } = await import("./components/WowGameSection");
const { settingsStore } = await import("./settings");

test("a linked page offers Retry for a failed launch read while the Play row stays clear", async () => {
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
  const playRow = () => container.querySelector("#play-row")!;
  const retry = () =>
    [...addonSection().querySelectorAll("button")].find((button) => button.textContent === "Retry");

  try {
    await settingsStore.load();
    await act(async () => {
      root.render(
        <>
          <WowGameSection appId={42} attachLaunch={() => {}} />
          <SteamLaunchActionRow
            appId={42}
            row={
              <div id="play-row">
                {[<button key="play">Play</button>, <button key="manage">Manage</button>]}
              </div>
            }
            index={2}
          />
        </>,
      );
    });
    expect(playRow().textContent).toBe("PlayManage");
    expect(playRow().getAttribute("flow-children")).toBeNull();
    await act(async () => fake.next("launch.state").fail(new Error("bridge disconnected")));
    expect(playRow().textContent).toBe("PlayManage");
    expect(playRow().getAttribute("flow-children")).toBeNull();
    expect(addonSection().textContent).toContain("Couldn't check WoW launch status");
    expect(retry()?.disabled).toBe(false);
    await act(async () => retry()?.click());
    expect(retry()?.disabled).toBe(true);
    const target = {
      kind: "wow",
      id: "forever",
      gameType: "forever",
      name: "Forever",
      shortName: "Forever",
      launchable: true,
    } as const;
    await act(async () =>
      fake.next("launch.state").resolve({
        state: {
          target,
          clients: [target],
          busy: false,
          entryRunning: true,
          gameRunning: "not_running",
        },
      }),
    );
    expect(retry()).toBeUndefined();
    expect([...playRow().querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Play",
      "Manage",
      "Forever",
      "",
    ]);
    expect(playRow().getAttribute("flow-children")).toBe("row");

    await act(async () =>
      fake.emit({
        event: "launch.completed",
        params: { appId: 42, clientName: "Forever", outcome: "confirmed" },
      }),
    );
    await act(async () => fake.next("launch.state").fail(new Error("bridge disconnected")));
    expect(playRow().textContent).toBe("PlayManage");
    expect(playRow().getAttribute("flow-children")).toBeNull();
    await act(async () => retry()?.click());
    await act(async () => fake.next("launch.state").resolve({ state: null }));
    expect(retry()).toBeUndefined();
    expect(playRow().textContent).toBe("PlayManage");
    expect(playRow().getAttribute("flow-children")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    disconnect();
    dom.window.close();
    env.window = oldWindow;
    delete env.IS_REACT_ACT_ENVIRONMENT;
  }
});
