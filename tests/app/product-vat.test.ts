import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import {
  products,
  productPrices,
  productStock,
} from '../../src/modules/catalog/schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';

const prices = { retail: 100000, 'retail-vat': 110000 };

test('thuế sản phẩm mới mặc định 8%, nhận 10%; giữ luồng Manager / nhân viên chờ duyệt', async () => {
  const f = await setup();
  for (const [sku, taxRate, actor, status] of [
    ['VAT-DEFAULT', undefined, f.mgr, 'approved'],
    ['VAT-EIGHT', 8, f.mgr, 'approved'],
    ['VAT-TEN', 10, f.mgr, 'approved'],
    ['VAT-PENDING', 10, f.emp, 'pending'],
  ] as const) {
    const result = await f.call('/products', actor, 'POST', {
      sku,
      name: 'Sản phẩm VAT',
      prices,
      taxRate,
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.approvalStatus, status);
    const p = (await f.call('/products/' + sku, f.mgr)).data.product;
    assert.equal(p.taxOut, taxRate ?? 8);
    assert.equal(p.taxable, true);
    assert.equal(p.taxIn, null, 'không tự đặt thuế đầu vào');
    assert.deepEqual(
      Object.fromEntries(
        p.prices.map((v: { policyId: string; price: number }) => [
          v.policyId,
          v.price,
        ]),
      ),
      prices,
    );
  }
  assert.equal(
    (await f.call('/products/VAT-PENDING/approve', f.mgr, 'POST', {})).status,
    200,
  );
  assert.equal(
    (await f.call('/products/VAT-PENDING', f.mgr)).data.product.taxOut,
    10,
  );
});

test('VAT chỉ nhận số 8 hoặc 10; dữ liệu lỗi, tài khoản ngoài, sản phẩm thiếu không ghi sản phẩm / giá', async () => {
  const f = await setup(),
    original = (await f.call('/products/00123', f.mgr)).data.product;
  const update = {
    name: original.name,
    brand: original.brand,
    unit: original.unit,
    pattern: original.pattern,
    imageUrl: original.imageUrl,
    expectedUpdatedAt: original.updatedAt,
    prices: {},
  };
  const before = await f.db.select().from(products),
    oldPrices = await f.db.select().from(productPrices);
  for (const taxRate of [
    null,
    0,
    -1,
    5,
    9,
    11,
    8.5,
    '8',
    '10',
    true,
    false,
    {},
    [],
  ]) {
    assert.equal(
      (
        await f.call('/products', f.mgr, 'POST', {
          sku: 'VAT-BAD',
          name: 'Không hợp lệ',
          prices,
          taxRate,
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.call('/products/00123', f.mgr, 'PUT', { ...update, taxRate }))
        .status,
      400,
    );
  }
  for (const [cookie, status] of [
    ['', 401],
    [f.ncc, 403],
  ] as const) {
    assert.equal(
      (
        await f.call('/products', cookie, 'POST', {
          sku: 'VAT-DENIED',
          name: 'Không được tạo',
          prices,
          taxRate: 10,
        })
      ).status,
      status,
    );
    assert.equal(
      (
        await f.call('/products/00123', cookie, 'PUT', {
          ...update,
          taxRate: 10,
        })
      ).status,
      status,
    );
  }
  assert.equal(
    (
      await f.call('/products/MISSING', f.mgr, 'PUT', {
        ...update,
        taxRate: 10,
      })
    ).status,
    404,
  );
  assert.deepEqual(await f.db.select().from(products), before);
  assert.deepEqual(await f.db.select().from(productPrices), oldPrices);
});

test('cập nhật VAT lưu vào thuế đầu ra và audit; giữ thuế đầu vào / giá / tồn; chặn bản cũ và giữ tương thích client cũ', async () => {
  const f = await setup();
  await f.db
    .update(products)
    .set({
      taxable: true,
      taxOut: 8,
      taxIn: 5,
      taxBasis: 'Giá đã bao gồm thuế',
      sapoProductId: 'sapo-vat',
    })
    .where(eq(products.sku, '00123'));
  const original = (await f.call('/products/00123', f.mgr)).data.product;
  const stocks = await f.db.select().from(productStock),
    oldPrices = await f.db.select().from(productPrices);
  const body = {
    name: original.name,
    brand: original.brand,
    unit: original.unit,
    pattern: original.pattern,
    imageUrl: original.imageUrl,
    expectedUpdatedAt: original.updatedAt,
    prices: {},
    taxRate: 10,
  };
  const saved = await f.call('/products/00123', f.emp, 'PUT', body);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  let current = (await f.call('/products/00123', f.mgr)).data.product;
  assert.equal(current.taxOut, 10);
  assert.equal(current.taxable, true);
  for (const key of [
    'taxIn',
    'taxBasis',
    'sapoProductId',
    'approvalStatus',
    'sku',
  ])
    assert.equal(current[key], original[key]);
  assert.deepEqual(await f.db.select().from(productStock), stocks);
  assert.deepEqual(await f.db.select().from(productPrices), oldPrices);
  assert.equal(
    (await f.call('/products/00123', f.mgr, 'PUT', { ...body, taxRate: 8 }))
      .status,
    409,
  );
  assert.equal(
    (await f.call('/products/00123', f.mgr)).data.product.taxOut,
    10,
  );
  const audits = await f.db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.entityId, '00123'));
  const change = JSON.parse(audits.find((a) => a.action === 'update')!.data);
  assert.equal(change.before.taxOut, 8);
  assert.equal(change.after.taxOut, 10);
  assert.equal(change.after.taxable, true);
  // Client cũ gửi lại DTO thuế cũ hoặc không có trường taxRate: không tự đổi mức thuế.
  const meta = await f.call('/products/00123', f.mgr, 'PUT', {
    ...current,
    name: 'Chỉ sửa tên',
    prices: {},
    expectedUpdatedAt: current.updatedAt,
  });
  assert.equal(meta.status, 200);
  current = (await f.call('/products/00123', f.mgr)).data.product;
  assert.equal(current.taxOut, 10);
  await f.db
    .update(products)
    .set({ taxable: false, taxOut: null })
    .where(eq(products.sku, '00123'));
  const legacy = (await f.call('/products/00123', f.mgr)).data.product;
  assert.equal(
    (
      await f.call('/products/00123', f.mgr, 'PUT', {
        ...legacy,
        name: 'Chỉ sửa ảnh / tên cũ',
        prices: {},
        expectedUpdatedAt: legacy.updatedAt,
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.call('/products/00123', f.mgr)).data.product.taxable,
    false,
  );
  assert.equal(
    (await f.call('/products/00123', f.mgr)).data.product.taxOut,
    null,
  );
});
