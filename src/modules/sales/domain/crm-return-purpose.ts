import { AppError } from "../../../core/errors.ts";
export type CrmReturnPurpose = "credit" | "redelivery";
/** Legacy/POS requests retain their explicit financial effect; new CRM requests default to logistics. */
export function returnPurpose(snapshot: string): CrmReturnPurpose {
  try {
    return JSON.parse(snapshot)?.returnPurpose === "redelivery"
      ? "redelivery"
      : "credit";
  } catch {
    return "credit";
  }
}
export function requestedReturnPurpose(value: unknown): CrmReturnPurpose {
  if (value === undefined) return "redelivery";
  if (value !== "redelivery" && value !== "credit")
    throw new AppError(
      400,
      "Chọn nhận hàng để giao lại hoặc trả hàng giảm công nợ.",
    );
  return value;
}
/** Retire only packing/issue evidence that actually existed when goods came back. */
export function redeliveryOffsets(snapshot: string, lineId: string) {
  try {
    const s = JSON.parse(snapshot),
      safe = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
    return {
      packed: safe(s.redeliveryPackedByLine?.[lineId]),
      issued: safe(s.redeliveryIssuedByLine?.[lineId]),
    };
  } catch {
    return { packed: 0, issued: 0 };
  }
}
