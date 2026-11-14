import { createContext, useContext } from "react";
import { UNKNOWN_USER_COLOR } from "../domain/user-colors";
import type { UserColor } from "../domain/user-colors";

export const UserColorsContext = createContext<ReadonlyMap<string, UserColor>>(
  new Map(),
);

export function useUserColor(userId: string): UserColor {
  return useContext(UserColorsContext).get(userId) ?? UNKNOWN_USER_COLOR;
}
