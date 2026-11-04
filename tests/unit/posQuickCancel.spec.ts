import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.ts';
import {
  parseQuickCancelRequest,
  quickCancelReplay,
  type QuickCancelRequest,
} from '../../src/modules/sales/domain/posQuickCancel.ts';

const request: QuickCancelRequest = {
  key: 'quick-cancel-request-001',
  shiftId: 'shift-1',
  reason: 'Đã nhận lại hàng và hoàn tiền',
  reference: 'BANK-001',
  confirmed: true,
  revision: 4,
};
const marker = {
  ...request,
  by: 'manager-1',
  returnId: 'return-1',
  refundId: 'refund-1',
};

describe('Manager POS Quick Cancel request', () => {
  it('success: normalizes confirmed text while preserving the revision and key', () => {
    const input = {
      ...request,
      reason: ` ${request.reason} `,
      reference: undefined,
    };
    const result = parseQuickCancelRequest(input);
    expect(result).toEqual({ ...request, reference: '' });
  });

  it.each([
    { confirmed: false },
    { confirmed: 'true' },
    { reason: '   ' },
    { reason: 'x'.repeat(2001) },
    { reference: 'x'.repeat(201) },
    { key: 'short' },
    { key: 'x'.repeat(101) },
    { shiftId: '' },
    { reason: {} },
    { key: null },
  ])(
    'edge: rejects invalid input without silently truncating %j',
    (invalid) => {
      expect(() => parseQuickCancelRequest({ ...request, ...invalid })).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    },
  );

  it.each([
    undefined,
    -1,
    0.5,
    '4',
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])('edge: rejects invalid revision %s', (revision) => {
    expect(() => parseQuickCancelRequest({ ...request, revision })).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });

  it('edge: accepts zero revision and the maximum UI reason length in Vietnamese', () => {
    expect(
      parseQuickCancelRequest({
        ...request,
        revision: 0,
        reason: 'ệ'.repeat(2000),
      }).reason,
    ).toHaveLength(2000);
  });
});

describe('Manager POS Quick Cancel idempotency', () => {
  it('success: returns saved document IDs for exactly the same request', () => {
    expect(quickCancelReplay(marker, request, 'manager-1')).toEqual({
      returnId: 'return-1',
      refundId: 'refund-1',
      replayed: true,
    });
  });

  it('not found: allows the first cancellation when there is no marker', () => {
    expect(quickCancelReplay(undefined, request, 'manager-1')).toBeNull();
  });

  it('edge: supports zero-value bills without a refund document', () => {
    expect(
      quickCancelReplay({ ...marker, refundId: null }, request, 'manager-1')
        ?.refundId,
    ).toBeNull();
  });

  it.each([
    { key: 'different-request-key' },
    { shiftId: 'shift-2' },
    { reason: 'Lý do khác' },
    { reference: 'BANK-002' },
    { revision: 5 },
  ])('conflict: refuses a replay with changed fields %j', (changed) => {
    expect(() =>
      quickCancelReplay(marker, { ...request, ...changed }, 'manager-1'),
    ).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('conflict: refuses to replay as a different Manager', () => {
    expect(() => quickCancelReplay(marker, request, 'manager-2')).toThrow(
      AppError,
    );
  });

  it.each([
    null,
    false,
    {},
    { ...marker, returnId: '' },
    { ...marker, refundId: undefined },
  ])(
    'exception: blocks a corrupt marker %j instead of authorizing another posting',
    (saved) => {
      expect(() => quickCancelReplay(saved, request, 'manager-1')).toThrow(
        expect.objectContaining({ status: 409 }),
      );
    },
  );
});
