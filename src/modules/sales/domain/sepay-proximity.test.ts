import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseNearbySepay,
  sepayWindow,
  webOrderCreatedAt,
  isBankWebMethod,
} from "./sepay-proximity.ts";
const at = "2026-11-08T03:00:00.000Z",
  settled = "2026-11-08T03:05:00.000Z";
test("SePay window spans both sides and crosses midnight without local timezone guessing", () => {
  assert.deepEqual(sepayWindow(at), {
    from: "2026-11-08T02:55:00.000Z",
    to: settled,
  });
  assert.equal(
    sepayWindow("2026-11-08T00:00:00Z").from,
    "2026-11-07T23:55:00.000Z",
  );
  assert.throws(() => sepayWindow("bad"));
});
test("exact integer amounts and inclusive ±5 minute boundaries; never approximately match or pick an arbitrary nearest tie", () => {
  for (const time of ["2026-11-08T02:55:00.000Z", settled])
    assert.equal(
      chooseNearbySepay([{ amount: 100, at: time }], 100, at, settled).status,
      "matched",
    );
  for (const row of [
    { amount: 99, at },
    { amount: 100.01, at },
    { amount: 100, at: "2026-11-08T03:05:00.001Z" },
  ])
    assert.equal(
      chooseNearbySepay([row], 100, at, settled).status,
      "unmatched",
    );
  assert.equal(
    chooseNearbySepay(
      [
        { amount: 100, at },
        { amount: 100, at: "2026-11-08T03:01:00Z" },
      ],
      100,
      at,
      settled,
    ).status,
    "review",
  );
  assert.equal(
    chooseNearbySepay([{ amount: 100, at }], 100, at, settled, true).status,
    "review",
  );
});
test("amount-only matching waits for the future side to close", () => {
  assert.equal(
    chooseNearbySepay([{ amount: 100, at }], 100, at, at).status,
    "review",
  );
  assert.equal(chooseNearbySepay([], 100, at, at).status, "review");
});
test("Woo timestamps normalize GMT and Vietnam local inputs; explicit offsets remain authoritative", () => {
  assert.equal(webOrderCreatedAt("2026-11-08T03:00:00", "", at), at);
  assert.equal(webOrderCreatedAt("", "2026-11-08T10:00:00", at), at);
  assert.equal(webOrderCreatedAt("", "2026-11-08T10:00:00+07:00", at), at);
  assert.equal(webOrderCreatedAt("", "", at), at);
  assert.throws(() => webOrderCreatedAt("bad", "", at));
  for (const method of [
    "SePay",
    "Chuyển khoản ngân hàng",
    "Quét mã QR",
    "bacs",
  ])
    assert.equal(isBankWebMethod(method), true);
  for (const method of [
    "COD",
    "Thanh toán khi nhận hàng",
    "Tiền mặt",
    "Credit card",
  ])
    assert.equal(isBankWebMethod(method), false);
});
