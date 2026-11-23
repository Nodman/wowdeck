import { DETAILS_CARD_COLOURS, DETAILS_CARD_GRADIENT, STEAM } from "./steamTheme";

type RGB = [number, number, number];
type Colour = [number, number, number, number];
type Background = RGB[];
const floor = 4.5;

function parseColour(value: string): Colour | null {
  if (value === "transparent") return [0, 0, 0, 0];
  if (/^#[\da-f]{6}$/i.test(value)) {
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).concat(1) as Colour;
  }
  const match = /^rgba?\(([^)]+)\)$/.exec(value);
  if (!match) return null;
  const parts = match[1].trim().split(/[\s,/]+/);
  if (parts.length < 3 || parts.length > 4) return null;
  const rgb = parts.slice(0, 3).map((v) => parseFloat(v) * (v.endsWith("%") ? 2.55 : 1));
  const alpha = parts[3] ? parseFloat(parts[3]) / (parts[3].endsWith("%") ? 100 : 1) : 1;
  if (
    ![...rgb, alpha].every(Number.isFinite) ||
    rgb.some((v) => v < 0 || v > 255) ||
    alpha < 0 ||
    alpha > 1
  )
    return null;
  return [...rgb, alpha] as Colour;
}
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const luminance = (rgb: RGB) =>
  rgb.reduce((y, v, i) => y + linear(v / 255) * [0.2126, 0.7152, 0.0722][i], 0);
const composite = (fg: Colour, bg: RGB): RGB =>
  fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])) as RGB;

/** A conservative lower bound over the whole known gradient, including alpha.
 * Independent foreground/background luminance bounds may underestimate contrast,
 * but never call a crossing of the two luminance ranges readable.
 */
function contrastBound(fg: Colour, backgrounds: Background): number {
  const f = backgrounds.map((bg) => luminance(composite(fg, bg)));
  const b = backgrounds.map(luminance);
  const fMin = Math.min(...f),
    fMax = Math.max(...f);
  const bMin = Math.min(...b),
    bMax = Math.max(...b);
  if (fMin > bMax) return (fMin + 0.05) / (bMax + 0.05);
  if (bMin > fMax) return (bMin + 0.05) / (fMax + 0.05);
  return 1;
}

/** Keep alpha foregrounds coupled to the same background. Subdivision uses
 * lower bounds, not just samples, to certify every point of our sRGB gradient.
 * A counterexample proves failure. Exhausting the budget is unresolved rather
 * than a reason to recolour text that might already pass.
 */
function contrast(fg: Colour, backgrounds: Background): number | null {
  const whole = contrastBound(fg, backgrounds);
  if (fg[3] === 1 || backgrounds.length === 1 || whole >= floor) return whole;
  const pending: Background[] = [backgrounds];
  let remaining = 128;
  let certified = Infinity;
  while (pending.length) {
    const [start, end] = pending.pop()!;
    const lower = contrastBound(fg, [start, end]);
    if (lower >= floor) {
      certified = Math.min(certified, lower);
      continue;
    }
    const endpoints = Math.min(contrastBound(fg, [start]), contrastBound(fg, [end]));
    if (endpoints < floor) return endpoints;
    if (--remaining === 0) return null;
    const midpoint = start.map((v, i) => (v + end[i]) / 2) as RGB;
    pending.push([start, midpoint], [midpoint, end]);
  }
  return certified;
}
const meetsContrast = (fg: Colour, backgrounds: Background) =>
  (contrast(fg, backgrounds) ?? 0) >= floor;

// sRGB/Oklab transforms use the published colour-space definitions:
// https://www.w3.org/TR/css-color-4/#color-conversion-code
function toLab(c: Colour): RGB {
  const [r, g, b] = c.slice(0, 3).map((v) => linear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromLab([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (c: RGB) => c.every((v) => v >= -1e-7 && v <= 1 + 1e-7);
function atLightness(original: RGB, L: number, alpha: number): Colour {
  let lo = 0,
    hi = 1;
  if (inGamut(fromLab([L, original[1], original[2]]))) lo = 1;
  else
    for (let i = 0; i < 16; i++) {
      const scale = (lo + hi) / 2;
      if (inGamut(fromLab([L, original[1] * scale, original[2] * scale]))) lo = scale;
      else hi = scale;
    }
  const c = fromLab([L, original[1] * lo, original[2] * lo]);
  return [...c.map((v) => Math.round(Math.min(1, Math.max(0, gamma(v))) * 255)), alpha] as Colour;
}
function repair(original: Colour, backgrounds: Background): Colour | null {
  const lab = toLab(original);
  // Preserve alpha when it can work. Otherwise an opaque foreground can
  // retain the hue without leaving faint text unresolved unnecessarily.
  for (const alpha of original[3] === 1 ? [1] : [original[3], 1]) {
    const same = [...original.slice(0, 3), alpha] as Colour;
    if (meetsContrast(same, backgrounds)) return same;
    const candidates: Colour[] = [];
    for (const end of [0, 1]) {
      let previous = lab[0];
      for (let step = 1; step <= 64; step++) {
        const L = lab[0] + ((end - lab[0]) * step) / 64;
        const candidate = atLightness(lab, L, alpha);
        if (meetsContrast(candidate, backgrounds)) {
          let failing = previous,
            passing = L;
          for (let i = 0; i < 18; i++) {
            const mid = (failing + passing) / 2;
            if (meetsContrast(atLightness(lab, mid, alpha), backgrounds)) passing = mid;
            else failing = mid;
          }
          candidates.push(atLightness(lab, passing, alpha));
          break;
        }
        previous = L;
      }
    }
    const distance = (c: Colour) => toLab(c).reduce((sum, v, i) => sum + (v - lab[i]) ** 2, 0);
    candidates.sort((a, b) => distance(a) - distance(b));
    if (candidates.length) return candidates[0];
  }
  const fallback = parseColour(STEAM.text)!;
  return meetsContrast(fallback, backgrounds) ? fallback : null;
}

interface Paint {
  backgrounds: Background | null;
  hidden: boolean;
  unsupported: boolean;
}
function paint(parent: Paint, style: CSSStyleDeclaration, knownGradient: string): Paint {
  const opacity = style.opacity === "" ? 1 : Number(style.opacity);
  const hidden = parent.hidden || style.display === "none" || opacity === 0;
  const unsupported =
    parent.unsupported ||
    !Number.isFinite(opacity) ||
    (opacity > 0 && opacity < 1) ||
    (!!style.filter && style.filter !== "none") ||
    (!!style.mixBlendMode && style.mixBlendMode !== "normal");
  let backgrounds = parent.backgrounds;
  // Backdrop effects change what shows through transparent surfaces. An
  // opaque background encountered below can still establish known paint.
  if (style.backdropFilter && style.backdropFilter !== "none") backgrounds = null;
  const bg = parseColour(style.backgroundColor);
  if (bg) {
    if (bg[3] === 1) backgrounds = [bg.slice(0, 3) as RGB];
    else if (backgrounds) backgrounds = backgrounds.map((b) => composite(bg, b));
  } else backgrounds = null;
  if (style.backgroundImage && style.backgroundImage !== "none") {
    backgrounds =
      knownGradient !== "" &&
      style.backgroundImage === knownGradient &&
      (!style.backgroundBlendMode || style.backgroundBlendMode === "normal")
        ? DETAILS_CARD_COLOURS.map((c) => parseColour(c)!.slice(0, 3) as RGB)
        : null;
  }
  return { backgrounds, hidden, unsupported };
}

/** Owns only text-run wrappers and bounded summary counts in this container.
 * Restoring the original text before each pass prevents both colour drift and
 * ancestor corrections from changing already-readable descendants.
 */
export function watchTextContrast(root: HTMLElement): () => void {
  const view = root.ownerDocument.defaultView;
  if (!view) return () => {};
  // CSSOM may omit the explicit default "in srgb" when serializing. Use
  // this document's normalization for the known-gradient comparison too.
  const gradientStyle = root.ownerDocument.createElement("span").style;
  gradientStyle.backgroundImage = DETAILS_CARD_GRADIENT;
  const knownGradient = gradientStyle.backgroundImage;
  let wrappers: HTMLSpanElement[] = [];
  let stopped = false;
  const observer = new view.MutationObserver(refresh);
  const ancestors: Element[] = [];
  for (let e = root.parentElement; e; e = e.parentElement) ancestors.unshift(e);
  function restore() {
    for (const span of wrappers)
      if (span.parentNode) span.replaceWith(...Array.from(span.childNodes));
    wrappers = [];
  }
  function observe() {
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
    for (const e of ancestors)
      observer.observe(e, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
  }
  function refresh() {
    if (stopped) return;
    observer.disconnect();
    restore();
    const initial: Paint = { backgrounds: null, hidden: false, unsupported: false };
    const outside = ancestors.reduce(
      (p, e) => paint(p, view!.getComputedStyle(e), knownGradient),
      initial,
    );
    const counts = { passed: 0, corrected: 0, unresolved: 0 };
    const cache = new Map<string, Colour | null>();
    function visit(element: HTMLElement, inherited: Paint) {
      const style = view!.getComputedStyle(element);
      const state = paint(inherited, style, knownGradient);
      if (state.hidden) return;
      const colour = parseColour(style.color);
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 1) {
          const el = child as HTMLElement;
          // SVG text and embedded documents are not HTML text runs.
          if (
            el.namespaceURI === "http://www.w3.org/1999/xhtml" &&
            !["STYLE", "SCRIPT", "IFRAME"].includes(el.tagName)
          )
            visit(el, state);
        } else if (
          child.nodeType === 3 &&
          child.textContent?.trim() &&
          style.visibility !== "hidden" &&
          style.visibility !== "collapse"
        ) {
          if (colour?.[3] === 0) continue;
          if (!colour || state.unsupported || !state.backgrounds) {
            counts.unresolved++;
            continue;
          }
          const measured = contrast(colour, state.backgrounds);
          if (measured === null) {
            counts.unresolved++;
            continue;
          }
          if (measured >= floor) {
            counts.passed++;
            continue;
          }
          const key = JSON.stringify([colour, state.backgrounds]);
          if (!cache.has(key)) cache.set(key, repair(colour, state.backgrounds));
          const next = cache.get(key);
          if (!next) {
            counts.unresolved++;
            continue;
          }
          const span = root.ownerDocument.createElement("span");
          span.style.color = `rgba(${next.join(",")})`;
          child.replaceWith(span);
          span.append(child);
          wrappers.push(span);
          counts.corrected++;
        }
      }
    }
    visit(root, outside);
    root.dataset.wowdeckContrast = `passed=${counts.passed} corrected=${counts.corrected} unresolved=${counts.unresolved}`;
    observe();
  }
  function paintSettled(event: Event) {
    const target = event.target as Node | null;
    if (target?.nodeType === 1 && (root.contains(target) || ancestors.includes(target as Element)))
      refresh();
  }
  const paintEvents = ["transitionend", "animationend", "transitioncancel", "animationcancel"];
  refresh();
  view.addEventListener("resize", refresh);
  for (const event of paintEvents) view.addEventListener(event, paintSettled, true);
  return () => {
    stopped = true;
    observer.disconnect();
    view.removeEventListener("resize", refresh);
    for (const event of paintEvents) view.removeEventListener(event, paintSettled, true);
    restore();
    delete root.dataset.wowdeckContrast;
  };
}
