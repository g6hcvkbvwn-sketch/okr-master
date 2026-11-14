import type { Project } from "../shared/types";

export interface UserColor {
  name: string;
  text: string;
  background: string;
}

export const USER_COLOR_PALETTE: readonly UserColor[] = [
  { name: "blue", text: "#1e40af", background: "#dbeafe" },
  { name: "orange", text: "#9a3412", background: "#ffedd5" },
  { name: "green", text: "#166534", background: "#dcfce7" },
  { name: "purple", text: "#6b21a8", background: "#f3e8ff" },
  { name: "teal", text: "#115e59", background: "#ccfbf1" },
  { name: "pink", text: "#9d174d", background: "#fce7f3" },
  { name: "amber", text: "#854d0e", background: "#fef3c7" },
  { name: "indigo", text: "#3730a3", background: "#e0e7ff" },
  { name: "rose", text: "#9f1239", background: "#ffe4e6" },
  { name: "cyan", text: "#155e75", background: "#cffafe" },
  { name: "brown", text: "#6b3f1d", background: "#f1e4d8" },
  { name: "slate", text: "#334155", background: "#e2e8f0" },
];

export const UNKNOWN_USER_COLOR: UserColor = {
  name: "unknown",
  text: "#536077",
  background: "#f2f5fa",
};

const GOLDEN_ANGLE = 137.508;

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r, g, b] =
    segment < 1 ? [chroma, secondary, 0]
    : segment < 2 ? [secondary, chroma, 0]
    : segment < 3 ? [0, chroma, secondary]
    : segment < 4 ? [0, secondary, chroma]
    : segment < 5 ? [secondary, 0, chroma]
    : [chroma, 0, secondary];
  const offset = l - chroma / 2;
  return `#${[r, g, b]
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Returns the color for a position; positions beyond the palette get generated hues. */
export function userColorForIndex(index: number): UserColor {
  if (!Number.isInteger(index) || index < 0) return UNKNOWN_USER_COLOR;
  const paletteColor = USER_COLOR_PALETTE[index];
  if (paletteColor) return paletteColor;

  const generatedIndex = index - USER_COLOR_PALETTE.length;
  const hue = (generatedIndex * GOLDEN_ANGLE + 17) % 360;
  // Alternate lightness bands so repeated hue regions remain distinguishable.
  const band = Math.floor(generatedIndex / 12) % 3;
  return {
    name: `generated-${generatedIndex + 1}`,
    text: hslToHex(hue, 70, 24 - band * 3),
    background: hslToHex(hue, 75, 92 - band * 2),
  };
}

/**
 * Assigns each user a distinct color by position: current project users in list
 * order first, then users that only exist in completed-cycle snapshots.
 */
export function assignUserColors(
  project: Pick<Project, "users" | "cycles">,
): ReadonlyMap<string, UserColor> {
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    orderedIds.push(id);
  };

  project.users.forEach((user) => add(user.id));
  [...project.cycles]
    .sort((left, right) => left.startMonth.localeCompare(right.startMonth))
    .forEach((cycle) => cycle.userSnapshots.forEach((user) => add(user.id)));

  return new Map(orderedIds.map((id, index) => [id, userColorForIndex(index)]));
}
