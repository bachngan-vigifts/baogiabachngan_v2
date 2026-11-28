import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../../core/errors.ts";
import {
  decideSepayMatch,
  sepayInvoiceCandidates,
  normalizeSepayReference,
  parseSepayPayment,
  sepayPaidDate,
  sepayReferenceCandidates,
} from "./sepay-payment.ts";

test("SePay normalizes Vietnamese separators and parses aliases", () => {
  assert.equal(
    normalizeSepayReference("Thanh toán 16-12/19052026/HĐKT/ABC"),
    "THANHTOAN161219052026HDKTABC",
  );
  const p = parseSepayPayment({
    id: 12,
    transfer_type: "in",
    amount: "100000",
    account_number: " 123 456 ",
    description: "DH-001",
    transaction_date: "2026-11-09 10:00:00",
  });
  assert.deepEqual(
    [p.providerId, p.amount, p.accountNumber, p.transferType],
    ["12", 100000, "123456", "in"],
  );
});

test("whole reference candidates preserve boundaries and Vietnamese HĐKT without unbounded work", () => {
  const values = sepayReferenceCandidates(
    "Thanh toán 16-12/19052026/HĐKT/ABC FT123",
  );
  assert.ok(
    values.includes(normalizeSepayReference("16-12/19052026/HĐKT/ABC")),
  );
  assert.ok(
    sepayReferenceCandidates("Thanh toan DH 001 08112026").includes(
      "DH00108112026",
    ),
  );
  for (const value of ["DH10", "DH 1 0", "XD H1", "PDH1", "DH1EXT"])
    assert.ok(!sepayReferenceCandidates(value).includes("DH1"));
  assert.deepEqual(sepayReferenceCandidates("word ".repeat(65)), []);
  assert.ok(sepayReferenceCandidates("word ".repeat(64)).length <= 1024);
});

test("separated document components stay atomic and never emit a prefix or suffix", () => {
  const short = "DH20261109001";
  for (const content of [
    "DH_20261109_001-ABC", "DH_20261109_001/ABC",
    "DH_20261109_001_ABC", "DH_20261109_001.ABC",
    "DH_20261109_001 - ABC", "DH_20261109_001 / ABC",
    "DH_20261109_001 – ABC", "DH_20261109_001 -- ABC",
    "DH_20261109_001 _ / ABC", "PREFIX-DH_20261109_001",
    "PREFIX / DH_20261109_001",
  ]) assert.ok(!sepayReferenceCandidates(content).includes(short), content);
  assert.ok(sepayReferenceCandidates("Thanh toán (DH_20261109_001-ABC), FT123")
    .includes(short + "ABC"));
  assert.ok(sepayReferenceCandidates("Thanh toán DH _ 20261109 _ 001 - ABC")
    .includes(short + "ABC"));
  assert.ok(sepayReferenceCandidates("Thanh toán DH_20261109_001; FT123")
    .includes(short));
});

test("bank dates without offsets use Vietnam time; explicit UTC is preserved, paidAt is the VN calendar day", () => {
  const base = {
    id: "date",
    transferType: "in",
    amount: 10,
    accountNumber: "123456",
    content: "DH1",
  };
  for (const date of [
    "2026-11-08 00:10:00",
    "2026-11-08T00:10:00",
    "2026-11-08T00:10:00+07:00",
    "2026-11-07T17:10:00Z",
  ]) {
    const p = parseSepayPayment({ ...base, transactionDate: date });
    assert.equal(p.transactionAt, "2026-11-07T17:10:00.000Z");
    assert.equal(sepayPaidDate(p.transactionAt), "2026-11-08");
  }
  for (const date of [
    "",
    "2026-02-30 10:00:00",
    "2026-11-08 24:00:00",
    "2026-11-08 10:60:00",
    "2099-01-01 00:00:00",
  ])
    assert.throws(
      () => parseSepayPayment({ ...base, transactionDate: date }),
      AppError,
    );
});

test("amounts must be positive integer VND; oversized IDs/content are rejected rather than truncated", () => {
  const base = {
    id: "money",
    transferType: "in",
    accountNumber: "123456",
    content: "DH1",
    transactionDate: "2026-11-08 10:00:00",
  };
  for (const amount of [
    0,
    -1,
    0.1,
    1.5,
    1e13,
    true,
    {},
    "0x10",
    "1e5",
    "1,000",
    Infinity,
  ])
    assert.throws(() => parseSepayPayment({ ...base, amount }), AppError);
  assert.equal(parseSepayPayment({ ...base, amount: "100.00" }).amount, 100);
  for (const patch of [{ id: "a".repeat(201) }, { content: "a".repeat(2001) }])
    assert.throws(
      () => parseSepayPayment({ ...base, amount: 100, ...patch }),
      AppError,
    );
});

test("SePay rejects outbound, missing id, zero and malformed date", () => {
  for (const b of [
    { id: 1, transferType: "out", transferAmount: 1, content: "DH1" },
    {
      transferType: "in",
      transferAmount: 1,
      accountNumber: "1",
      content: "DH1",
    },
    {
      id: 1,
      transferType: "in",
      transferAmount: 0,
      accountNumber: "1",
      content: "DH1",
    },
    {
      id: 1,
      transferType: "in",
      transferAmount: 1,
      accountNumber: "1",
      content: "DH1",
      transactionDate: "nope",
    },
    { id: 1, transferType: "in", transferAmount: 1, content: "DH1" },
  ])
    assert.throws(() => parseSepayPayment(b), AppError);
});

test("SePay only auto-matches one order without overpayment", () => {
  assert.equal(decideSepayMatch([], 1).status, "unmatched");
  assert.equal(
    decideSepayMatch(
      [
        { id: "a", outstanding: 2 },
        { id: "b", outstanding: 2 },
      ],
      1,
    ).status,
    "review",
  );
  assert.equal(
    decideSepayMatch([{ id: "a", outstanding: 0 }], 1).status,
    "review",
  );
  assert.equal(
    decideSepayMatch([{ id: "a", outstanding: 99 }], 100).status,
    "review",
  );
  assert.equal(
    decideSepayMatch([{ id: "a", outstanding: 0.6 }], 1).status,
    "review",
  );
  assert.deepEqual(decideSepayMatch([{ id: "a", outstanding: 100 }], 40), {
    status: "matched",
    reason: "",
    orderId: "a",
  });
});

test('invoice reference labels preserve complete identifiers and never infer bare amounts',()=>{
 assert.deepEqual(sepayInvoiceCandidates('thanh toán hóa đơn số 000123'),['000123']);
 assert.deepEqual(sepayInvoiceCandidates('hóa đơn số:000123'),['000123']);
 assert.deepEqual(sepayInvoiceCandidates('TT HD 000123 / ABC'),['000123ABC']);
 assert.deepEqual(sepayInvoiceCandidates('TT INVOICE 000123-ABC'),['000123ABC']);
 assert.deepEqual(sepayInvoiceCandidates('hóa đơn số 000123, 000456'),['000123','000456']);
 assert.deepEqual(sepayInvoiceCandidates('chuyen 000123 dong'),[]);
 assert.deepEqual(sepayInvoiceCandidates('hoa don so 000123 456'),[]);
 assert.equal(decideSepayMatch([{id:'a',outstanding:100}],40,true).status,'review');
 assert.equal(decideSepayMatch([{id:'a',outstanding:100}],100,true).status,'matched');
});
