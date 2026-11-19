import { expect, test } from "bun:test";
import { findPlayRowInsertion } from "./steamPlayRow";

const classes = { actionRow: "row", panel: "panel", playButton: "play", appButtons: "buttons" };
const node = (className: string, children: unknown[] = []) => ({ props: { className, children } });

test("a rendered modern Play row inserts after Steam's buttons", () => {
  const play = node("panel", [node("play")]);
  expect(
    findPlayRowInsertion(
      node("other", [node("row", [play, node("stats"), node("buttons")])]),
      classes,
    )?.index,
  ).toBe(3);
});

test("a row with a different Play group stays untouched", () => {
  expect(
    findPlayRowInsertion(
      node("row", [node("panel", [node("play-extra")]), node("buttons")]),
      classes,
    ),
  ).toBeUndefined();
});
