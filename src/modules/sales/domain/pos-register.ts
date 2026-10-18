import { fold } from "../../../core/text/fold.ts";

/** Gợi ý quầy theo chức vụ; đây không phải giới hạn quyền bán ở quầy khác. */
export function defaultPosRegister(
  positionId: string | null | undefined,
  positionName: string | null | undefined,
  registers: readonly { id: string; name: string; active: boolean }[],
): string | null {
  const position = fold(positionName);
  const name =
    positionId === "sales-lock" ||
    ["nvbh lock", "cht lock", "cua hang truong lock"].includes(position)
      ? "quay lock"
      : positionId === "sales-ml" ||
          [
            "nvbh ml",
            "nvbh minh long",
            "cht ml",
            "cht minh long",
            "cua hang truong minh long",
          ].includes(position)
        ? "quay minh long"
        : null;
  const matches = name
    ? registers.filter((r) => r.active && fold(r.name) === name)
    : [];
  return matches.length === 1 ? matches[0]!.id : null;
}
