/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import cassette from "../backend/tests/fixtures/providers/curseforge/cassette.json";
import { wowdeckSharedStyleCss } from "./sharedStyles";
import { DETAILS_CARD_GRADIENT } from "./steamTheme";

const dom = new JSDOM("");
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
mock.module("@decky/ui", () => ({ Navigation: { NavigateToExternalWeb: () => {} } }));
const { SafeMarkdown } = await import("./components/SafeMarkdown");
let root: Root | undefined;
let host: HTMLDivElement;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

async function render(markdown: string, background = "#25282e") {
  if (!root) {
    const style = document.createElement("style");
    style.textContent = wowdeckSharedStyleCss();
    document.head.append(style);
    host = document.createElement("div");
    host.style.cssText = `background-color:${background};color:rgb(207,210,211)`;
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => root!.render(<SafeMarkdown markdown={markdown} />));
  return host.querySelector<HTMLElement>(".wowdeck-markdown")!;
}
const rgb = (s: string) => s.match(/[\d.]+/g)!.map(Number);
function luminance(c: number[]) {
  return c
    .slice(0, 3)
    .reduce(
      (sum, v, i) =>
        sum +
        (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4) *
          [0.2126, 0.7152, 0.0722][i],
      0,
    );
}
function ratio(fg: number[], bg: number[]) {
  const a = fg[3] ?? 1;
  const f = luminance(fg.slice(0, 3).map((v, i) => a * v + (1 - a) * bg[i]));
  const b = luminance(bg);
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
}
function textColour(selector: string) {
  const el = host.querySelector(selector)!;
  const walker = document.createTreeWalker(el, dom.window.NodeFilter.SHOW_TEXT);
  walker.nextNode();
  return rgb(dom.window.getComputedStyle(walker.currentNode.parentElement!).color);
}

test("passing author colours remain exact while failing text is corrected", async () => {
  const view = await render(
    '<p id="good" style="color:#66c0f4">Readable</p><p id="bad" style="color:#333">Faint</p>',
  );
  expect(textColour("#good")).toEqual([102, 192, 244]);
  expect(ratio(textColour("#bad"), [37, 40, 46])).toBeGreaterThanOrEqual(4.5);
  expect(view.dataset.wowdeckContrast).toContain("corrected=1");
});

test("light surfaces darken faint coloured text while retaining its colour character", async () => {
  await render('<p id="bad" style="color:#ffbbdd">Pink</p>', "white");
  const c = textColour("#bad");
  expect(ratio(c, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  expect(c[0]).toBeGreaterThan(c[1]);
  expect(c[2]).toBeGreaterThan(c[1]);
});

test("a corrected parent's direct text does not recolour a passing child", async () => {
  await render(
    '<div id="parent" style="color:#333">Faint <span id="child" style="background-color:white">Readable on white</span></div>',
  );
  expect(ratio(textColour("#parent"), [37, 40, 46])).toBeGreaterThanOrEqual(4.5);
  expect(textColour("#child")).toEqual([51, 51, 51]);
  expect(dom.window.getComputedStyle(host.querySelector("#child")!).backgroundColor).toBe(
    "rgb(255, 255, 255)",
  );
});

test("transparent backgrounds and foregrounds are composited", async () => {
  await render(
    '<div style="background-color:rgba(255,255,255,.5)"><span id="bad" style="color:rgba(120,120,120,.7)">Faint</span></div>',
  );
  expect(ratio(textColour("#bad"), [146, 147.5, 150.5])).toBeGreaterThanOrEqual(4.5);
});

test("the recorded Details! text passes over both ends of the modal gradient", async () => {
  const entry = cassette.interactions.find((e) => e.url.endsWith("/mods/61284/description"))!;
  const description = (entry.response as { data: string }).data;
  const view = await render(description);
  await act(async () => {
    host.style.backgroundImage = DETAILS_CARD_GRADIENT;
  });
  const walker = document.createTreeWalker(view, dom.window.NodeFilter.SHOW_TEXT);
  let count = 0;
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    const fg = rgb(dom.window.getComputedStyle(walker.currentNode.parentElement!).color);
    for (const bg of [
      [37, 40, 46],
      [66, 69, 76],
    ])
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    count++;
  }
  expect(count).toBeGreaterThan(10);
  expect(view.dataset.wowdeckContrast).toContain("unresolved=0");
});

test("unsupported background images and group opacity are unresolved", async () => {
  const view = await render('<p id="bad" style="color:#333">Text</p>');
  await act(async () => {
    host.style.backgroundImage = 'url("https://example.com/background.png")';
  });
  expect(textColour("#bad")).toEqual([51, 51, 51]);
  expect(view.dataset.wowdeckContrast).toContain("unresolved=1");
  await act(async () => {
    host.style.backgroundImage = "none";
    host.style.opacity = ".5";
  });
  expect(view.dataset.wowdeckContrast).toContain("unresolved=1");
});

test("new content and background changes are rechecked without colour drift", async () => {
  await render('<p id="bad" style="color:#333">Original</p>');
  const first = textColour("#bad");
  await act(async () => {
    host.className = "changed";
  });
  expect(textColour("#bad")).toEqual(first);
  await act(async () => {
    host.style.backgroundColor = "white";
  });
  expect(textColour("#bad")).toEqual([51, 51, 51]);
  await render('<p id="new" style="color:#ddd">Replacement</p>');
  expect(host.querySelector("#bad")).toBeNull();
  expect(ratio(textColour("#new"), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  const old = host;
  await act(async () => root!.unmount());
  root = undefined;
  const saved = old.innerHTML;
  await act(async () => {
    old.style.backgroundColor = "black";
  });
  expect(old.innerHTML).toBe(saved);
});

test("correction leaves image links, screenshots and allowed embeds intact", async () => {
  const view = await render(
    '<p style="color:#333">Text</p><a href="https://example.com/faq"><img src="https://example.com/faq.png" alt="FAQ"></a><img src="https://example.com/screen.png"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
  );
  expect(view.querySelectorAll("img")).toHaveLength(2);
  expect(dom.window.getComputedStyle(view.querySelector("img")!).backgroundColor).toBe(
    "rgba(0, 0, 0, 0)",
  );
  expect(view.querySelector("a")!.getAttribute("href")).toBe("https://example.com/faq");
  expect(view.querySelector("iframe")!.getAttribute("src")).toContain("youtube-nocookie.com");
});

test("alpha over the modal gradient can become opaque when needed for contrast", async () => {
  const view = await render(
    '<div style="background-color:rgba(255,255,255,.5)"><span id="faint" style="color:rgba(120,120,120,.7)">Faint</span></div>',
  );
  await act(async () => {
    host.style.backgroundImage = DETAILS_CARD_GRADIENT;
  });
  for (const bg of [
    [146, 147.5, 150.5],
    [160.5, 162, 165.5],
  ])
    expect(ratio(textColour("#faint"), bg)).toBeGreaterThanOrEqual(4.5);
  expect(view.dataset.wowdeckContrast).toContain("unresolved=0");
});

test("a supported background range that admits no single foreground stays unresolved", async () => {
  const view = await render(
    '<p id="faint" style="background-color:rgba(255,255,255,.35);color:#777">Faint</p>',
  );
  await act(async () => {
    host.style.backgroundImage = DETAILS_CARD_GRADIENT;
  });
  expect(textColour("#faint")).toEqual([119, 119, 119]);
  expect(view.dataset.wowdeckContrast).toBe("passed=0 corrected=0 unresolved=1");
});

test("fully transparent and hidden text is not exposed by correction", async () => {
  const view = await render(
    '<p id="invisible" style="color:transparent">Hidden</p><p hidden>Hidden too</p>',
  );
  expect(textColour("#invisible")[3]).toBe(0);
  expect(view.dataset.wowdeckContrast).toBe("passed=0 corrected=0 unresolved=0");
});

test("opening transitions recheck text after CSS opacity changes without a DOM mutation", async () => {
  const view = await render('<p id="bad" style="color:#333">Faint</p>');
  const style = document.createElement("style");
  style.textContent = ".opening { opacity:0 }";
  document.head.append(style);
  await act(async () => {
    host.className = "opening";
  });
  expect(view.dataset.wowdeckContrast).toBe("passed=0 corrected=0 unresolved=0");
  const rule = style.sheet!.cssRules[0] as CSSStyleRule;
  await act(async () => {
    rule.style.opacity = "1";
    host.dispatchEvent(new dom.window.Event("transitionend", { bubbles: true }));
  });
  expect(ratio(textColour("#bad"), [37, 40, 46])).toBeGreaterThanOrEqual(4.5);
  expect(view.dataset.wowdeckContrast).toContain("corrected=1");
});

test("a transparent backdrop filter is unresolved unless an opaque child covers it", async () => {
  const view = await render('<p id="bad" style="color:#333">Text</p>');
  await act(async () => {
    document.body.style.backgroundColor = "#25282e";
    host.style.backgroundColor = "transparent";
    host.style.backdropFilter = "blur(2px)";
  });
  expect(view.dataset.wowdeckContrast).toContain("unresolved=1");
  expect(textColour("#bad")).toEqual([51, 51, 51]);
  await render('<p id="bad" style="background-color:white;color:#333">Covered</p>');
  expect(view.dataset.wowdeckContrast).toBe("passed=1 corrected=0 unresolved=0");
});

test("blending the known gradient does not reuse its unblended contrast bounds", async () => {
  const view = await render('<p style="color:#333">Text</p>');
  await act(async () => {
    host.style.backgroundImage = DETAILS_CARD_GRADIENT;
    host.style.backgroundBlendMode = "multiply";
  });
  expect(view.dataset.wowdeckContrast).toBe("passed=0 corrected=0 unresolved=1");
});

test("already-readable alpha text is preserved across the whole modal gradient", async () => {
  const view = await render(
    '<p id="readable" style="color:rgba(255,255,255,.6)">Readable alpha</p>',
  );
  await act(async () => {
    host.style.backgroundImage = DETAILS_CARD_GRADIENT;
  });
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    const bg = [37 + 29 * t, 40 + 29 * t, 46 + 30 * t];
    expect(ratio([255, 255, 255, 0.6], bg)).toBeGreaterThanOrEqual(4.5);
  }
  expect(textColour("#readable")).toEqual([255, 255, 255, 0.6]);
  expect(view.dataset.wowdeckContrast).toBe("passed=1 corrected=0 unresolved=0");
});

test("failing low-alpha text may become opaque when alpha cannot meet contrast", async () => {
  const view = await render('<p id="faint" style="color:rgba(120,120,120,.05)">Faint</p>', "white");
  const fg = textColour("#faint");
  expect(fg[3] ?? 1).toBe(1);
  expect(ratio(fg, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  expect(view.dataset.wowdeckContrast).toBe("passed=0 corrected=1 unresolved=0");
});
