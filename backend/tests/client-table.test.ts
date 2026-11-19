import { describe, expect, test } from "bun:test";
import { WOW_CLIENTS, wowClient, wowClientForFolder } from "../src/wow/clients";
import { WowClientType } from "../src/wow/types";
import { getClientTypeForGameType } from "../src/wow/utils/gametype";

const clientTypes = Object.values(WowClientType).filter(
  (value): value is WowClientType => typeof value === "number" && value !== WowClientType.None,
);

describe("client table", () => {
  test("every client type has a complete record", () => {
    for (const clientType of clientTypes) {
      const client = wowClient(clientType);
      expect(client, WowClientType[clientType]).toBeDefined();
      expect(client!.folder).toMatch(/^_[a-z_]+_$/);
      expect(client!.gameType).not.toBe("");
      expect(client!.wowGameType).not.toBe("");
      expect(client!.shortName).not.toBe("");
      expect(client!.fullName).not.toBe("");
      expect(Array.isArray(client!.formerNames)).toBe(true);
      expect(["product", "version", "none"]).toContain(client!.launch.kind);
    }
    expect(WOW_CLIENTS).toHaveLength(clientTypes.length);
    expect(wowClient(WowClientType.None)).toBeUndefined();
  });

  test("folders and client types are unique", () => {
    expect(new Set(WOW_CLIENTS.map((c) => c.folder)).size).toBe(WOW_CLIENTS.length);
    expect(new Set(WOW_CLIENTS.map((c) => c.clientType)).size).toBe(WOW_CLIENTS.length);
  });

  test("each game type maps back to one client that carries it", () => {
    // Several clients share a game type (the PTRs, Classic Era and
    // Anniversary); the reverse lookup names the main one.
    for (const { gameType } of WOW_CLIENTS) {
      expect(wowClient(getClientTypeForGameType(gameType))?.gameType).toBe(gameType);
    }
    expect(getClientTypeForGameType("ptr")).toBe(WowClientType.RetailPtr);
    expect(getClientTypeForGameType("classic_era")).toBe(WowClientType.ClassicEra);
    expect(getClientTypeForGameType("classic")).toBe(WowClientType.Classic);
  });

  test("folders resolve to their client", () => {
    expect(wowClientForFolder("_forever_")?.clientType).toBe(WowClientType.Forever);
    expect(wowClientForFolder("_classic_beta_")?.clientType).toBe(WowClientType.ClassicBeta);
    expect(wowClientForFolder("_nope_")).toBeUndefined();
    expect(wowClientForFolder("hasOwnProperty")).toBeUndefined();
  });

  test("Battle.net launch kinds follow docs/steam-launch-targets.md", () => {
    expect(wowClient(WowClientType.Retail)!.launch).toEqual({
      kind: "product",
      code: "WoW",
      exact: true,
    });
    expect(wowClient(WowClientType.Forever)!.launch).toEqual({
      kind: "product",
      code: "WoWF",
      exact: true,
    });
    expect(wowClient(WowClientType.Classic)!.launch).toEqual({
      kind: "product",
      code: "WoWC",
      exact: false,
    });
    expect(wowClient(WowClientType.ClassicEra)!.launch).toEqual({
      kind: "version",
      uid: "wow_classic_era",
    });
    expect(wowClient(WowClientType.Anniversary)!.launch).toEqual({
      kind: "version",
      uid: "wow_classic_anniversary",
    });
    expect(wowClient(WowClientType.ClassicTitan)!.launch).toEqual({
      kind: "version",
      uid: "wow_classic_titan",
    });
    // Battle.net's own UIDs, as its log lists them (Deck, 2026-11-18).
    expect(wowClient(WowClientType.RetailPtr)!.launch).toEqual({ kind: "version", uid: "wow_ptr" });
    expect(wowClient(WowClientType.RetailXPtr)!.launch).toEqual({
      kind: "version",
      uid: "wow_ptr_x",
    });
    expect(wowClient(WowClientType.Beta)!.launch).toEqual({ kind: "version", uid: "wow_beta" });
    expect(wowClient(WowClientType.ClassicPtr)!.launch).toEqual({
      kind: "version",
      uid: "wow_classic_ptr",
    });
    expect(wowClient(WowClientType.ClassicEraPtr)!.launch).toEqual({
      kind: "version",
      uid: "wow_classic_era_ptr",
    });
    expect(wowClient(WowClientType.ClassicBeta)!.launch).toEqual({
      kind: "version",
      uid: "wow_classic_beta",
    });
    expect(wowClient(WowClientType.ClassicCnBeta)!.launch).toEqual({ kind: "none" });
  });
});
