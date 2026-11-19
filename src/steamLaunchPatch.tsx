import {
  afterPatch,
  appActionButtonClasses,
  appDetailsClasses,
  findClassModule,
  getReactInstance,
  playSectionClasses,
} from "@decky/ui";
import { LinkedSteamLaunchControl } from "./components/SteamLaunchControl";
import { findPlayRowInsertion, type RowClasses } from "./steamPlayRow";

const CONTROL_KEY = "wowdeck-launch";

interface ActionRow {
  render: (props: { overview?: { appid?: unknown } }) => unknown;
}

interface Fiber {
  type?: unknown;
  return?: Fiber | null;
  memoizedProps?: { overview?: { appid?: unknown }; onGameInfoButtonToggle?: unknown };
  stateNode?: { forceUpdate?: () => void };
}

function isActionRow(type: unknown): type is ActionRow {
  const render = (type as Partial<ActionRow> | null)?.render;
  return (
    typeof render === "function" &&
    String(render).includes(".ActionRow") &&
    String(render).includes(".AppButtons")
  );
}

/**
 * The modern Deck layout renders an opaque ActionRow inside PlaySection.
 * Find the forwardRef that owns the committed row with Decky's getReactInstance.
 * The owning fiber's type and overview, and the game details class's
 * onGameInfoButtonToggle prop, were observed on the Deck. Ask that class
 * to render once so an already-mounted row picks up the patch.
 * Missing anchors leave the addon section in place.
 */
export function createSteamLaunchPatch() {
  const patches = new Map<ActionRow, ReturnType<typeof afterPatch>>();
  let warned = false;

  function warn() {
    if (!warned) console.warn("wowdeck: launch control unavailable on this Steam game page layout");
    warned = true;
  }

  function attach(anchor: HTMLElement, appId: number): void {
    try {
      const css = findClassModule((module) =>
        [
          "PlaySection",
          "ActionRow",
          "ActionButtonAndStatusPanel",
          "AppActionButton",
          "AppButtons",
        ].every((key) => typeof module[key] === "string"),
      );
      const containerClass = appDetailsClasses?.InnerContainer;
      if (!css || !containerClass || !appActionButtonClasses || !playSectionClasses) return warn();
      const container = anchor.closest(`.${CSS.escape(containerClass)}`);
      const section = container?.getElementsByClassName(css.PlaySection!)[0];
      const row = section?.getElementsByClassName(css.ActionRow!)[0];
      if (!row) return warn();

      let fiber = getReactInstance(row) as Fiber | undefined | null;
      while (fiber && !isActionRow(fiber.type)) fiber = fiber.return;
      const renderer = fiber?.type;
      if (!isActionRow(renderer) || fiber?.memoizedProps?.overview?.appid !== appId) return warn();
      if (patches.has(renderer)) return;

      const classes: RowClasses = {
        actionRow: css.ActionRow!,
        panel: css.ActionButtonAndStatusPanel!,
        playButton: css.AppActionButton!,
        appButtons: css.AppButtons!,
      };
      const patch = afterPatch(renderer, "render", ([props], tree: unknown) => {
        try {
          const id = props?.overview?.appid;
          if (typeof id !== "number") return tree;
          const insertion = findPlayRowInsertion(tree, classes);
          if (!insertion) {
            warn();
            return tree;
          }
          const children = insertion.children as ({ key?: string | null } | null)[];
          if (!children.some((child) => child?.key === CONTROL_KEY)) {
            children.splice(
              insertion.index,
              0,
              <LinkedSteamLaunchControl key={CONTROL_KEY} appId={id} />,
            );
          }
        } catch {
          warn();
        }
        return tree;
      });
      patches.set(renderer, patch);

      for (let parent = fiber.return; parent; parent = parent.return) {
        const instance = parent.stateNode;
        if (
          parent.memoizedProps?.overview?.appid === appId &&
          typeof parent.memoizedProps.onGameInfoButtonToggle === "function" &&
          typeof instance?.forceUpdate === "function"
        ) {
          instance.forceUpdate();
          break;
        }
      }
    } catch {
      warn();
    }
  }

  return {
    attach,
    dispose() {
      for (const patch of patches.values()) patch.unpatch();
      patches.clear();
    },
  };
}
