import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LinkedGame, LinkedGames } from "../backend/src/api/contracts";
import { defaultSettings } from "../backend/src/wow/storage/settings";
import { deckyUiStub } from "./deckyUiStub";
import { connectEngine } from "./engineLink";
import { createFakeEngine, settle, type FakeEngine } from "./testSupport/fakeEngine";

/**
 * Options › Steam library (#290): one row with a status line, opening a
 * modal that lists the linked games (A removes one) and the toggles for
 * Steam's pages. Rendered over a fake engine with the real stores.
 */

const toasts: string[] = [];
mock.module("@decky/api", () => ({
  toaster: { toast: ({ title }: { title: string }) => toasts.push(title) },
}));

let shown: ReactElement | null = null;
type Row = {
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  onOKActionDescription?: string;
  children?: ReactNode;
};
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  // A row as the player reads it: label, description, A's footer action.
  Field: ({ label, description, disabled, onClick, onOKActionDescription, children }: Row) => (
    <div data-row data-disabled={disabled ? "true" : undefined} onClick={onClick}>
      <b>{label}</b>
      <i>{description}</i>
      {children}
      {onOKActionDescription && <footer>A: {onOKActionDescription}</footer>}
    </div>
  ),
  ToggleField: ({
    label,
    description,
    disabled,
    checked,
    onChange,
  }: Row & { checked?: boolean; onChange?: (on: boolean) => void }) => (
    <div data-row data-disabled={disabled ? "true" : undefined}>
      <b>{label}</b>
      <i>{description}</i>
      <input
        type="checkbox"
        aria-label={String(label)}
        checked={checked ?? false}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
    </div>
  ),
  showModal: (element: ReactElement) => {
    shown = element;
    return { Close: () => {} };
  },
}));

const { SteamLibrarySection } = await import("./components/settings/SteamLibrarySection");
const { settingsStore } = await import("./settings");
const { linkedGamesStore } = await import("./linkedGames");

const WOW: LinkedGame = { appId: 42, name: "World of Warcraft", source: "found" };
const BNET: LinkedGame = { appId: 43, name: "Battle.net", source: "added" };

const env = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
const oldWindow = env.window;
let dom: JSDOM;
let root: Root;
let fake: FakeEngine;
let disconnect: () => void;

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  env.window = dom.window;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  fake = createFakeEngine();
  disconnect = connectEngine(fake);
  root = createRoot(dom.window.document.getElementById("root")!);
  toasts.splice(0);
  shown = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  disconnect();
  dom.window.close();
  env.window = oldWindow;
  delete env.IS_REACT_ACT_ENVIRONMENT;
});

/** What the engine holds: Show in Steam and the linked games. */
async function engineHas(linked: LinkedGames) {
  fake.answers["settings.get"] = {
    settings: { ...defaultSettings(), steamEnabled: linked.enabled },
  };
  fake.answers["linkedGames.get"] = linked;
  await act(async () => {
    await settingsStore.load();
    await linkedGamesStore.load();
  });
}

/** Every heading and row, in order: "label · description", "(disabled)", "A: action". */
function read(): string[] {
  const doc = dom.window.document;
  return [...doc.querySelectorAll("#root h2, #root h3, #root [data-row]")].map((el) => {
    if (!el.hasAttribute("data-row")) return el.textContent ?? "";
    const label = el.querySelector(":scope > b")?.textContent ?? "";
    const description = el.querySelector(":scope > i")?.textContent ?? "";
    const action = el.querySelector(":scope > footer")?.textContent;
    return [
      description ? `${label} · ${description}` : label,
      el.getAttribute("data-disabled") ? "(disabled)" : "",
      action ?? "",
    ]
      .filter(Boolean)
      .join(" ");
  });
}

const optionsRow = async () => {
  await act(async () => root.render(<SteamLibrarySection />));
  return read();
};

async function openModal() {
  await act(async () => root.render(<SteamLibrarySection />));
  const row = dom.window.document.querySelector<HTMLElement>("#root [data-row]")!;
  await act(async () => row.click());
  await act(async () => root.render(shown!));
}

const row = (label: string) =>
  [...dom.window.document.querySelectorAll<HTMLElement>("#root [data-row]")].find(
    (el) => el.querySelector(":scope > b")?.textContent === label,
  )!;

test("the Options row says where things stand: one game, several, none, or off", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · On · World of Warcraft"]);
  await engineHas({ enabled: true, games: [WOW, BNET] });
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · On · 2 games"]);
  await engineHas({ enabled: true, games: [] });
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · On · No games"]);
  await engineHas({ enabled: false, games: [WOW] });
  expect(await optionsRow()).toEqual(["Steam library", "Steam library · Off"]);
});

test("the modal lists the master switch, each linked game and the toggles for Steam's pages", async () => {
  await engineHas({ enabled: true, games: [WOW, BNET] });
  await openModal();
  expect(read()).toEqual([
    "Steam library",
    "Show in Steam · Addon updates on game pages and tiles",
    "Linked games",
    "World of Warcraft · Found automatically A: Remove",
    "Battle.net · Added by you A: Remove",
    "On these pages",
    "Check for updates · When the page or tile appears, at most every 15 minutes",
    "Tile badge · Green when updates are waiting",
    "Play starts WoW · Pick the version with the arrow beside it",
  ]);
});

test("with nothing linked the list says so", async () => {
  await engineHas({ enabled: true, games: [] });
  await openModal();
  expect(read().slice(2, 4)).toEqual(["Linked games", "No games linked"]);
});

test("A on a game row removes it and says so", async () => {
  await engineHas({ enabled: true, games: [WOW, BNET] });
  fake.answers["linkedGames.remove"] = ({ appId }) => ({
    enabled: true,
    games: [WOW, BNET].filter((game) => game.appId !== appId),
  });
  await openModal();
  await act(async () => row("Battle.net").click());
  await settle();
  expect(fake.paramsOf("linkedGames.remove")).toEqual([{ appId: BNET.appId }]);
  expect(toasts).toEqual(["Removed Battle.net"]);
  expect(read()).not.toContain("Battle.net · Added by you A: Remove");
});

test("a remove the engine refuses keeps the game and says it couldn't", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  await openModal();
  const removing = act(async () => row("World of Warcraft").click());
  await fake.next("linkedGames.remove").reject("io_error", "disk full");
  await removing;
  expect(toasts).toEqual(["Couldn't remove World of Warcraft"]);
  expect(read()).toContain("World of Warcraft · Found automatically A: Remove");
});

test("Show in Steam off greys out the three page rows in place", async () => {
  await engineHas({ enabled: false, games: [WOW] });
  await openModal();
  expect(read().slice(-4)).toEqual([
    "On these pages",
    "Check for updates · When the page or tile appears, at most every 15 minutes (disabled)",
    "Tile badge · Green when updates are waiting (disabled)",
    "Play starts WoW · Pick the version with the arrow beside it (disabled)",
  ]);
  expect(read()).toContain("World of Warcraft · Found automatically A: Remove");
});

test("flipping Show in Steam saves it, and the page rows follow at once", async () => {
  await engineHas({ enabled: true, games: [WOW] });
  await openModal();
  const toggle = row("Show in Steam").querySelector("input")!;
  await act(async () => toggle.click());
  expect(fake.paramsOf("settings.set")).toEqual([{ settings: { steamEnabled: false } }]);
  expect(row("Tile badge").getAttribute("data-disabled")).toBe("true");
});
