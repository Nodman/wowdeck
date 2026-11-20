import { useEffect, useRef, useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  Focusable,
  ModalRoot,
  TextField,
  showModal,
} from "@decky/ui";
import { TextRow } from "./TextRow";
import { ScrollBuffer } from "./ScrollBuffer";
import { wowupModalStyleCss } from "../sharedStyles";
import { STEAM, descriptionStyle } from "../steamTheme";
import {
  filterSteamGames,
  likelyWowFirst,
  listSteamShortcuts,
  pickerRowMarker,
  steamShortcutIcon,
  type SteamGame,
} from "../steamLibrary";
import type { LinkedGame } from "../../backend/src/api/contracts";

/** Rows shown at once; libraries with 800+ shortcuts narrow down by typing. */
const MAX_ROWS = 40;

/**
 * Steam loads a shortcut's icon only when asked, and answers in about 200 ms
 * (spike #152): a shown row that came up without an icon is looked up once
 * more after this long. Shortcuts with no icon never get one, so there is no
 * second retry.
 */
const ICON_REREAD_MS = 500;

/**
 * Icon slot size: tall enough to span the name and the description line, so
 * both start at the same place. A row without an icon keeps the same blank space.
 */
const ICON_SIZE = "40px";

function readShortcuts(): SteamGame[] {
  return likelyWowFirst(listSteamShortcuts());
}

/**
 * Icon URLs for the rows shown, by app id. Each app id is looked up when its
 * row first shows, and once more `ICON_REREAD_MS` later if it had none. Only
 * the URLs are kept, never Steam's overview objects; timers stop on close.
 */
function useShortcutIcons(shown: SteamGame[]): ReadonlyMap<number, string> {
  const [icons, setIcons] = useState<ReadonlyMap<number, string>>(() => new Map());
  const lookedUp = useRef(new Set<number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const shownKey = shown.map((g) => g.appId).join(",");
  useEffect(() => {
    const lookUp = (ids: number[]) => {
      const found = new Map<number, string>();
      const missing: number[] = [];
      for (const id of ids) {
        const url = steamShortcutIcon(id);
        if (url) found.set(id, url);
        else missing.push(id);
      }
      if (found.size) setIcons((prev) => new Map([...prev, ...found]));
      return missing;
    };
    const fresh = shownKey
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((id) => !lookedUp.current.has(id));
    fresh.forEach((id) => lookedUp.current.add(id));
    const missing = lookUp(fresh);
    if (missing.length === 0) return;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      lookUp(missing);
    }, ICON_REREAD_MS);
    timers.current.add(timer);
  }, [shownKey]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  return icons;
}

/**
 * Pick the Steam library entry that launches WoW (BEYOND-05): one text row
 * to narrow down (S28), then the non-Steam shortcuts as rows, likely WoW
 * entries first (WoW itself, or the Battle.net launcher people add); A links
 * one beside the games already linked. "Unlink" for each game the player
 * added; B leaves it as it was. The panel is unmounted while this is open
 * (G4): `onPick` and `onUnlink` go to the engine (linkedGamesStore).
 */
function SteamGamePicker({
  linked,
  onPick,
  onUnlink,
  closeModal,
}: {
  linked: LinkedGame[];
  onPick: (game: SteamGame) => void;
  onUnlink: (game: SteamGame) => void;
  closeModal?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [all] = useState(readShortcuts);
  const matches = filterSteamGames(all, query);
  const shown = matches.slice(0, MAX_ROWS);
  const icons = useShortcutIcons(shown);
  const pick = (game: SteamGame) => {
    onPick(game);
    closeModal?.();
  };
  const unlink = (game: SteamGame) => {
    onUnlink(game);
    closeModal?.();
  };
  const added = linked.filter((game) => game.source === "added");
  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>World of Warcraft in Steam</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogControlsSection>
            <TextRow label="Search your non-Steam games" layout="inline">
              <TextField value={query} onChange={(e) => setQuery(e.target.value)} />
            </TextRow>
            {all.length === 0 && (
              <Field
                label="No non-Steam games found"
                description={
                  <span style={descriptionStyle}>
                    Add the WoW launcher (Lutris, Battle.net or Wow.exe) to Steam as a non-Steam
                    game first
                  </span>
                }
              />
            )}
            {all.length > 0 && matches.length === 0 && (
              <Field label={`Nothing matches “${query}”`} />
            )}
            {shown.map((g) => (
              <SteamGameRow
                key={g.appId}
                game={g}
                icon={icons.get(g.appId)}
                linked={linked}
                onPick={pick}
              />
            ))}
            {matches.length > MAX_ROWS && (
              <Field
                label={`${matches.length - MAX_ROWS} more`}
                description={<span style={descriptionStyle}>Type to narrow down the list</span>}
              />
            )}
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      {added.length > 0 && (
        <DialogFooter>
          <Focusable flow-children="row" className="DialogTwoColLayout _DialogColLayout">
            {added.map((game) => (
              <DialogButton key={game.appId} onClick={() => unlink(game)}>
                Unlink {game.name}
              </DialogButton>
            ))}
            <DialogButton onClick={closeModal}>Cancel</DialogButton>
          </Focusable>
        </DialogFooter>
      )}
    </ModalRoot>
  );
}

/**
 * One shortcut: its icon (or a blank slot), then its name over its app id and
 * link marker. The marker goes last so every app id lines up; A links it.
 */
function SteamGameRow({
  game,
  icon,
  linked,
  onPick,
}: {
  game: SteamGame;
  icon?: string;
  linked: LinkedGame[];
  onPick: (game: SteamGame) => void;
}) {
  const marker = pickerRowMarker(game, linked);
  return (
    <Field
      focusable
      label={
        <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <IconSlot icon={icon} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span data-row-name>{game.name}</span>
            <span data-row-description style={descriptionStyle}>
              App {game.appId}
              {marker && (
                <>
                  {" · "}
                  <span
                    style={marker === "Currently linked" ? { color: STEAM.positive } : undefined}
                  >
                    {marker}
                  </span>
                </>
              )}
            </span>
          </span>
        </span>
      }
      onClick={() => onPick(game)}
      onOKActionDescription="Link"
    />
  );
}

/** Decorative: hidden from screen readers; blank when there is no icon or it fails to load. */
function IconSlot({ icon }: { icon?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      data-icon-slot
      aria-hidden="true"
      style={{ width: ICON_SIZE, height: ICON_SIZE, flex: "none" }}
    >
      {icon && icon !== failed && (
        <img
          src={icon}
          alt=""
          decoding="async"
          style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
          onError={() => setFailed(icon)}
        />
      )}
    </span>
  );
}

export function openSteamGamePicker(
  linked: LinkedGame[],
  onPick: (game: SteamGame) => void,
  onUnlink: (game: SteamGame) => void,
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <SteamGamePicker linked={linked} onPick={onPick} onUnlink={onUnlink} closeModal={close} />,
    window,
    { strTitle: "World of Warcraft in Steam", bHideMainWindowForPopouts: false },
  );
}
