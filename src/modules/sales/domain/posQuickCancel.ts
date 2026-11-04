import { z } from 'zod';
import { AppError } from '../../../core/errors.ts';

const requestSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{16,100}$/),
  shiftId: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(2000),
  reference: z.string().trim().max(200).optional().default(''),
  confirmed: z.literal(true),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export type QuickCancelRequest = z.infer<typeof requestSchema>;
export interface QuickCancelReplay {
  returnId: string;
  refundId: string | null;
  replayed: true;
}

/** Reject rather than truncate: replay must compare exactly what the Manager confirmed. */
export function parseQuickCancelRequest(
  input: Record<string, unknown>,
): QuickCancelRequest {
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) {
    throw new AppError(409, 'Bill vừa thay đổi. Mở lại trước khi huỷ nhanh.');
  }
  const result = requestSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      400,
      'Nhập đúng ca, mã yêu cầu, lý do và xác nhận đã thu hồi đủ hàng, hoàn tiền thực tế.',
    );
  }
  return result.data;
}

const markerSchema = requestSchema.omit({ confirmed: true }).extend({
  by: z.string().min(1),
  returnId: z.string().min(1),
  refundId: z.string().min(1).nullable(),
});

/** A retry returns saved document IDs; a changed request never posts stock/refunds again. */
export function quickCancelReplay(
  marker: unknown,
  request: QuickCancelRequest,
  actorId: string,
): QuickCancelReplay | null {
  if (marker === undefined) return null;
  const result = markerSchema.safeParse(marker);
  if (!result.success) {
    throw new AppError(
      409,
      'Dấu huỷ nhanh không hợp lệ. Cần đối soát trước khi xử lý tiếp.',
    );
  }
  const prior = result.data;
  if (
    prior.by !== actorId ||
    (['key', 'reason', 'reference', 'shiftId', 'revision'] as const).some(
      (field) => prior[field] !== request[field],
    )
  ) {
    throw new AppError(
      409,
      'Bill đã được huỷ; không hoàn tiền hoặc nhập kho thêm lần nữa.',
    );
  }
  return { returnId: prior.returnId, refundId: prior.refundId, replayed: true };
}
