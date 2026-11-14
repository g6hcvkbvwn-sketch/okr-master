import { describe, expect, it } from "vitest";
import type { Cycle, User } from "../shared/types";
import {
  assignUserColors,
  UNKNOWN_USER_COLOR,
  USER_COLOR_PALETTE,
  userColorForIndex,
} from "./user-colors";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

function user(id: string): User {
  return { id, name: id, email: `${id}@example.com`, active: true };
}

function cycle(startMonth: string, snapshotIds: string[]): Cycle {
  return {
    startMonth,
    userSnapshots: snapshotIds.map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
  } as unknown as Cycle;
}

describe("user color palette", () => {
  it("contains at least 12 distinct hues", () => {
    expect(USER_COLOR_PALETTE.length).toBeGreaterThanOrEqual(12);
    expect(new Set(USER_COLOR_PALETTE.map((color) => color.text)).size).toBe(
      USER_COLOR_PALETTE.length,
    );
    expect(
      new Set(USER_COLOR_PALETTE.map((color) => color.background)).size,
    ).toBe(USER_COLOR_PALETTE.length);
  });

  it("meets WCAG AA contrast for palette and generated colors", () => {
    for (let index = 0; index < 80; index += 1) {
      const color = userColorForIndex(index);
      expect(contrastRatio(color.text, color.background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("userColorForIndex", () => {
  it("generates unique colors beyond the palette", () => {
    const colors = Array.from({ length: 60 }, (_, index) => userColorForIndex(index));
    expect(new Set(colors.map((color) => color.background)).size).toBe(60);
    expect(colors.every((color) => /^#[0-9a-f]{6}$/.test(color.text))).toBe(true);
  });

  it("returns the neutral color for invalid positions", () => {
    expect(userColorForIndex(-1)).toBe(UNKNOWN_USER_COLOR);
    expect(userColorForIndex(1.5)).toBe(UNKNOWN_USER_COLOR);
  });
});

describe("assignUserColors", () => {
  it("gives every project user a different color in list order", () => {
    const users = Array.from({ length: 15 }, (_, index) => user(`user-${index}`));
    const colors = assignUserColors({ users, cycles: [] });

    expect(colors.get("user-0")).toBe(USER_COLOR_PALETTE[0]);
    expect(colors.get("user-1")).toBe(USER_COLOR_PALETTE[1]);
    expect(new Set([...colors.values()].map((color) => color.background)).size).toBe(15);
  });

  it("is stable for the same project", () => {
    const project = { users: [user("a"), user("b")], cycles: [] };
    expect(assignUserColors(project).get("b")).toEqual(
      assignUserColors(project).get("b"),
    );
  });

  it("gives snapshot-only users colors that do not collide with current users", () => {
    const colors = assignUserColors({
      users: [user("a"), user("b")],
      cycles: [cycle("2026-04", ["b", "deleted-2"]), cycle("2026-01", ["a", "deleted-1"])],
    });

    expect(colors.get("a")).toBe(USER_COLOR_PALETTE[0]);
    expect(colors.get("b")).toBe(USER_COLOR_PALETTE[1]);
    expect(colors.get("deleted-1")).toBe(USER_COLOR_PALETTE[2]);
    expect(colors.get("deleted-2")).toBe(USER_COLOR_PALETTE[3]);
    expect(colors.size).toBe(4);
  });
});
