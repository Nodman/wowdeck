import {
  afterPatch,
  appDetailsClasses,
  findModule,
  findModuleExport,
  getReactInstance,
} from "@decky/ui";
import { cloneElement, isValidElement, type ReactElement } from "react";
import {
  isLinkedApp,
  steamPlayClasses,
  warnPlayButton,
  WowPlayButton,
  WowPlayMenu,
} from "./components/WowPlayButton";
import type { LaunchState } from "../backend/src/api/contracts";
import { hookObserverRender, type ObserverRenderHook } from "./observerRender";
import { steamEntryRunning } from "./steamLaunchActions";
import { steamEvent } from "./steamPlayButton";

/**
 * WoWDeck's client choice on Steam's own Play button (ADR 0016, #285).
 *
 * Steam renders Play, its chevron and its "Play from…" menu in one private
 * class component. It isn't exported, but an exported forwardRef wrapper
 * renders it (it adds `navigator` and `instance` props), so the patch finds
 * the class in the wrapper's render output. Steam's class is a mobx
 * observer, which locks each instance's `render` on its first render
 * (LIVE, 2026-11-18), so the patch hooks the class before an instance
 * renders (`observerRender.ts`) and remounts a button that rendered
 * earlier (a page open when the plugin loads) by keying the wrapper's
 * element. G13: every SteamUI property used here, its evidence (LIVE or
 * INFERRED) and what happens without it are in docs/ui/device-notes.md
 * §8.4e. Anything unexpected leaves Steam's plain Play button.
 */

interface PlayOverview {
  appid?: unknown;
  BIsSelectedClientLocal?: () => boolean;
}

interface PlayButtonInstance {
  props?: { overview?: PlayOverview };
  render: () => unknown;
  forceUpdate?: () => void;
  ShowStreamingMenu?: (event: unknown) => void;
}

interface Fiber {
  return?: Fiber | null;
  stateNode?: unknown;
}

const FORWARD_REF = Symbol.for("react.forward_ref");

/** Steam's Play button class: its prototype has the streaming menu and remote label methods. */
function isPlayButtonClass(type: unknown): boolean {
  const proto = (type as { prototype?: object } | null)?.prototype;
  return (
    typeof type === "function" &&
    !!proto &&
    "ShowStreamingMenu" in proto &&
    "GetTextForRemoteClientAction" in proto &&
    "render" in proto
  );
}

function isPlayButtonWrapper(candidate: unknown): candidate is { render: () => unknown } {
  const wrapper = candidate as { $$typeof?: unknown; render?: unknown } | null;
  if (wrapper?.$$typeof !== FORWARD_REF || typeof wrapper.render !== "function") return false;
  const source = String(wrapper.render);
  return source.includes("navigator:") && source.includes("instance:");
}

const isPlayButtonInstance = (node: unknown): node is PlayButtonInstance =>
  typeof node === "object" && node !== null && isPlayButtonClass(node.constructor);

/** The jsx runtime Steam's modules call through `e.jsx(...)` at call time. */
interface JsxRuntime {
  jsx: (type: unknown, props: Record<string, unknown> | null, ...rest: unknown[]) => unknown;
}

const PLAY_KEY = "wowdeck-play-button";

export function createSteamLaunchPatch() {
  let hook: ObserverRenderHook | undefined;
  let active = true;
  let unpatchWrapper: (() => void) | undefined;

  /** Open Steam's own menu, with its local row swapped for ours. */
  function openMenu(
    instance: PlayButtonInstance,
    appId: number,
    event: unknown,
    state: LaunchState,
  ) {
    const show = instance.ShowStreamingMenu;
    if (typeof show !== "function") return warnPlayButton("no Play from menu");
    const overview = instance.props?.overview;
    const localSelected =
      typeof overview?.BIsSelectedClientLocal === "function"
        ? overview.BIsSelectedClientLocal()
        : true;

    let runtime: JsxRuntime | undefined;
    try {
      runtime = findModule(
        (module: Partial<JsxRuntime> & { jsxs?: unknown; Fragment?: unknown }) =>
          typeof module?.jsx === "function" &&
          typeof module.jsxs === "function" &&
          module.Fragment !== undefined,
      ) as JsxRuntime | undefined;
    } catch {
      runtime = undefined;
    }
    const real = runtime?.jsx;
    let swapped = false;
    // Steam builds the menu element with the jsx runtime and shows it at
    // once. For that one call, its menu element (the one with
    // `onStreamingTargetSelected`) becomes our menu around Steam's.
    const intercept: JsxRuntime["jsx"] = (type, props, ...rest) => {
      if (
        !swapped &&
        typeof type === "function" &&
        typeof props?.onStreamingTargetSelected === "function"
      ) {
        swapped = true;
        const steamProps = props;
        return real!(
          WowPlayMenu,
          {
            appId,
            state,
            localSelected,
            steamMenu: () => (type as (props: unknown) => unknown)(steamProps),
          },
          ...rest,
        );
      }
      return real!(type, props, ...rest);
    };
    let installed = false;
    try {
      if (runtime && real) {
        runtime.jsx = intercept;
        installed = runtime.jsx === intercept;
      }
    } catch {
      installed = false;
    }
    try {
      show.call(instance, steamEvent(event));
    } finally {
      if (installed && runtime && real) runtime.jsx = real;
    }
    if (!swapped) warnPlayButton("Steam's Play from menu shown unchanged");
  }

  /** WoWDeck's button around the tree Steam's Play button class rendered. */
  function renderPlay(instance: object, tree: unknown): unknown {
    if (!active) return tree;
    try {
      const self = instance as PlayButtonInstance;
      const overview = self.props?.overview;
      const appId = overview?.appid;
      if (typeof appId !== "number" || !isLinkedApp(appId) || !steamPlayClasses()) {
        return tree;
      }
      const remote =
        typeof overview?.BIsSelectedClientLocal === "function" &&
        !overview.BIsSelectedClientLocal();
      return (
        <WowPlayButton
          key="wowdeck-play"
          appId={appId}
          tree={tree as ReactElement}
          remote={remote}
          steamEntryRunning={steamEntryRunning(overview)}
          openMenu={(event, state) => openMenu(self, appId, event, state)}
        />
      );
    } catch (error) {
      warnPlayButton("render failed", error);
      return tree;
    }
  }

  /** Hook Steam's Play button class once, before its next instance first renders. */
  function hookClass(cls: unknown): ObserverRenderHook | undefined {
    if (hook) return hook;
    try {
      hook = hookObserverRender(cls as { prototype: object }, renderPlay);
    } catch (error) {
      warnPlayButton("render not patchable", error);
    }
    return hook;
  }

  function install() {
    try {
      const wrapper = findModuleExport(isPlayButtonWrapper) as
        { render: () => unknown } | undefined;
      if (!wrapper) return warnPlayButton("no Play button wrapper");
      const patch = afterPatch(wrapper, "render", (_args: unknown[], element: unknown) => {
        try {
          if (!active || !isValidElement(element) || !isPlayButtonClass(element.type)) {
            return element;
          }
          if (!hookClass(element.type)) return element;
          // A new key remounts a button that rendered before the hook, so its
          // replacement renders through it. Unpatching drops the key and
          // remounts Steam's own again.
          return cloneElement(element, { key: PLAY_KEY });
        } catch (error) {
          warnPlayButton("wrapper patch failed", error);
          return element;
        }
      });
      unpatchWrapper = () => patch.unpatch();
    } catch (error) {
      warnPlayButton("wrapper not found", error);
    }
  }

  /**
   * Reach the Play button from the game page's DOM when the addon section
   * mounts: redraw it when it is hooked, or remount it when it rendered
   * before the hook (the plugin loaded with the page open).
   */
  function attach(anchor: HTMLElement, appId: number): void {
    try {
      const css = steamPlayClasses();
      const containerClass = appDetailsClasses?.InnerContainer;
      if (!css || !containerClass) return;
      const container = anchor.closest(`.${CSS.escape(containerClass)}`);
      const button = container?.getElementsByClassName(css.PlayButtonContainer)[0];
      if (!button) return;
      let fiber = getReactInstance(button) as Fiber | undefined | null;
      while (fiber && !isPlayButtonInstance(fiber.stateNode)) fiber = fiber.return;
      const instance = fiber?.stateNode as PlayButtonInstance | undefined;
      if (!fiber || instance?.props?.overview?.appid !== appId) return;
      const classHook = hookClass(instance.constructor);
      if (!classHook) return;
      if (classHook.isHooked(instance)) {
        // The addon section mounts on a linked page: draw the patched button now.
        instance.forceUpdate?.();
        return;
      }
      // Rendered before the hook: re-render the nearest component above it,
      // so Steam's wrapper hands back the keyed element and the button remounts.
      for (let above = fiber.return; above; above = above.return) {
        const node = above.stateNode as { forceUpdate?: () => void } | null;
        if (node && typeof node.forceUpdate === "function") {
          node.forceUpdate();
          return;
        }
      }
      warnPlayButton("no component above the Play button to remount it");
    } catch (error) {
      warnPlayButton("attach failed", error);
    }
  }

  return {
    install,
    attach,
    dispose() {
      // Hooked instances fall back to Steam's tree; the next page mounts unpatched.
      active = false;
      hook?.unhook();
      hook = undefined;
      unpatchWrapper?.();
      unpatchWrapper = undefined;
    },
  };
}
