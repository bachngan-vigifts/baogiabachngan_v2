import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLiquidation } from "../helpers/liquidation-fixture.ts";
test("mẫu nguồn theo đúng loại tài liệu thay vì chỉ HĐKT", async () => {
  const f = await setupLiquidation();
  const r = await f.call("/contract-template-sources/BN/TAM_UNG", f.mgr);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.documentType, "TAM_UNG");
});

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import {
  validateTemplateSource,
  MAX_TEMPLATE_BYTES,
} from "../../src/modules/sales/domain/contract-source-file.ts";
import manifest from "../../src/modules/sales/domain/contract-source-manifest.json" with { type: "json" };
import { contractTemplateSources } from "../../src/modules/sales/contract-source-schema.ts";
import { salesContracts } from "../../src/modules/sales/schema.ts";
const raw = (brand: "BN" | "VG", type: "HDKT" | "TAM_UNG" | "BBNT") =>
  new Uint8Array(readFileSync("trial-ui/" + manifest[brand][type].path));
const payload = (bytes: Uint8Array, revision = 0) => ({
  revision,
  clientKey: crypto.randomUUID(),
  fileName: "Mẫu thử.docx",
  base64: Buffer.from(bytes).toString("base64"),
});
const altered = (
  bytes: Uint8Array,
  change: (files: Record<string, Uint8Array>) => void,
) => {
  const files = unzipSync(bytes);
  change(files);
  return zipSync(files);
};

test("mọi file mẫu gốc có thể tải lại; chặn sai loại, macro/external/entity/ZIP bomb và file quá giới hạn", () => {
  for (const brand of ["BN", "VG"] as const)
    for (const type of ["HDKT", "TAM_UNG", "BBNT"] as const)
      assert.ok(
        validateTemplateSource(raw(brand, type), manifest[brand][type].fields)
          .entries,
      );
  const bytes = raw("VG", "TAM_UNG"),
    fields = manifest.VG.TAM_UNG.fields;
  assert.throws(
    () => validateTemplateSource(raw("VG", "HDKT"), fields),
    /đúng loại/,
  );
  assert.throws(
    () =>
      validateTemplateSource(new Uint8Array(MAX_TEMPLATE_BYTES + 1), fields),
    /3 MB/,
  );
  assert.throws(() =>
    validateTemplateSource(strToU8("<html>wrong</html>"), fields),
  );
  assert.throws(
    () => validateTemplateSource(bytes.slice(0, -22), fields),
    /ZIP/,
  );
  assert.throws(
    () =>
      validateTemplateSource(
        altered(bytes, (f) => {
          f["word/document.xml"] = strToU8(
            strFromU8(f["word/document.xml"]!).replace(
              "</w:body>",
              "<w:p><w:r><w:t>&lt;&lt; không đóng</w:t></w:r></w:p></w:body>",
            ),
          );
        }),
        fields,
      ),
    /tự điền/,
  );
  assert.throws(
    () =>
      validateTemplateSource(
        altered(bytes, (f) => {
          f["word/vbaProject.bin"] = new Uint8Array([1]);
        }),
        fields,
      ),
    /macro/,
  );
  assert.throws(
    () =>
      validateTemplateSource(
        altered(bytes, (f) => {
          f["word/_rels/evil.rels"] = strToU8(
            '<Relationships><Relationship TargetMode="External" Target="file:///private"/></Relationships>',
          );
        }),
        fields,
      ),
    /tài nguyên ngoài/,
  );
  assert.throws(
    () =>
      validateTemplateSource(
        altered(bytes, (f) => {
          f["word/evil.xml"] = strToU8(
            '<!DOCTYPE x [<!ENTITY a "boom">]><x>&a;</x>',
          );
        }),
        fields,
      ),
    /DTD/,
  );
  assert.throws(
    () =>
      validateTemplateSource(
        altered(bytes, (f) => {
          f["huge.txt"] = new Uint8Array(9 * 1024 * 1024);
        }),
        fields,
      ),
    /quá lớn/,
  );
});

test("Manager upload đúng loại/brand, version và replay; không nới quyền, không làm mất file khi xung đột", async () => {
  const f = await setupLiquidation(),
    url = "/contract-template-sources/VG/TAM_UNG",
    body = payload(raw("VG", "TAM_UNG"));
  for (const who of [f.emp, f.other, f.ncc]) {
    assert.equal((await f.call(url, who)).status, 403);
    assert.equal((await f.call(url, who, "POST", body)).status, 403);
  }
  assert.equal(f.files.files.size, 0);
  const first = await f.call(url, f.mgr, "POST", body);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.revision, 1);
  assert.equal(f.files.files.size, 1);
  assert.equal((await f.call(url, f.mgr, "POST", body)).data.replayed, true);
  assert.equal(f.files.files.size, 1);
  assert.equal(
    (await f.call("/contract-template-sources/BN/TAM_UNG", f.mgr, "POST", body))
      .status,
    400,
    "wrong brand template has different required fields",
  );
  const stale = await f.call(url, f.mgr, "POST", payload(raw("VG", "TAM_UNG")));
  assert.equal(stale.status, 409);
  assert.equal(
    f.files.files.size,
    1,
    "unused conflict upload cleaned, published file retained",
  );
  const metadata = await f.call(url, f.mgr);
  assert.equal(metadata.data.documentType, "TAM_UNG");
  assert.equal(metadata.data.revision, 1);
  assert.ok(metadata.data.source.url.startsWith("data:"));
  assert.ok(!JSON.stringify(metadata.data).includes("fileKey"));
  const [row] = await f.db.select().from(contractTemplateSources);
  assert.equal(row!.sourceHash, first.data.sourceHash);
});

const createContract = async (
  f: Awaited<ReturnType<typeof setupLiquidation>>,
  n: number,
) => {
  const q = await f.call("/quotes", f.emp, "POST", {
    type: "HRC",
    quoteNo: "SRC_" + n,
    customer: "Khách",
    customerTaxCode: "0312345678",
    vat: 8,
    rows: [{ name: "Ly", sku: "LY1", unit: "cái", qty: 1, price: 1000 }],
  });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  assert.equal(
    (
      await f.call("/quotes/" + q.data.id + "/approve", f.mgr, "POST", {
        revision: 1,
      })
    ).status,
    200,
  );
  const k = await f.call("/contracts", f.emp, "POST", {
    quoteId: q.data.id,
    legalEntity: "BN",
    pushSapo: false,
  });
  assert.equal(k.status, 201, JSON.stringify(k.data));
  return (
    await f.db
      .select()
      .from(salesContracts)
      .where(eq(salesContracts.id, k.data.id))
  )[0]!;
};
test("file mẫu mới chỉ vào snapshot hồ sơ mới; hồ sơ cũ giữ file cũ và người ngoài không nhận URL ký", async () => {
  const f = await setupLiquidation(),
    url = "/contract-template-sources/BN/BBNT";
  const legacy = await createContract(f, 1);
  assert.equal(
    (await f.call("/contracts/" + legacy.id + "/template-sources", f.emp))
      .status,
    200,
  );
  const one = await f.call(url, f.mgr, "POST", payload(raw("BN", "BBNT")));
  assert.equal(one.status, 200);
  const a = await createContract(f, 2),
    snapshotA = JSON.parse(a.data).templateSnapshot,
    sourceA = snapshotA.sources.BBNT;
  assert.equal(sourceA.revision, 1);
  assert.equal(snapshotA.version, 2);
  assert.equal(snapshotA.baseSourceHash, manifest.BN.HDKT.sourceHash);
  assert.notEqual(
    snapshotA.sourceHash,
    snapshotA.baseSourceHash,
    "old clients fail closed rather than render another source",
  );
  assert.equal(
    (await f.call("/contract-templates/BN", f.mgr)).data.sourceHash,
    manifest.BN.HDKT.sourceHash,
  );
  const next = altered(raw("BN", "BBNT"), (f) => {
    f["word/document.xml"] = strToU8(
      strFromU8(f["word/document.xml"]!).replace(
        "</w:body>",
        "<w:p><w:r><w:t>Mẫu thứ hai</w:t></w:r></w:p></w:body>",
      ),
    );
  });
  assert.equal(
    (await f.call(url, f.mgr, "POST", payload(next, 1))).status,
    200,
  );
  const b = await createContract(f, 3);
  assert.equal(JSON.parse(b.data).templateSnapshot.sources.BBNT.revision, 2);
  const oldView = await f.call(
    "/contracts/" + a.id + "/template-sources",
    f.emp,
  );
  assert.equal(oldView.status, 200);
  assert.equal(oldView.data.sources.BBNT.sourceHash, sourceA.sourceHash);
  assert.equal(oldView.data.sources.BBNT.revision, 1);
  assert.equal(
    (await f.call("/contracts/" + a.id + "/template-sources", f.other)).status,
    404,
  );
  assert.deepEqual(
    (await f.call("/contracts/" + legacy.id + "/template-sources", f.emp)).data
      .sources,
    {},
  );
  const [unchanged] = await f.db
    .select()
    .from(salesContracts)
    .where(eq(salesContracts.id, a.id));
  assert.equal(unchanged!.data, a.data);
});

test("hai Manager lưu cùng revision chỉ một thắng; audit lỗi rollback và không xoá file đã công bố khi mất ACK", async () => {
  const f = await setupLiquidation(),
    url = "/contract-template-sources/VG/HDKT",
    body = payload(raw("VG", "HDKT"));
  const real = f.db.transaction.bind(f.db);
  const mutable = f.db as unknown as {
    transaction: (...args: any[]) => Promise<any>;
  };
  mutable.transaction = async (...args: any[]) => {
    await (real as any)(...args);
    throw Error("fixture lost commit ACK");
  };
  const lost = await f.call(url, f.mgr, "POST", body);
  assert.equal(lost.status, 500);
  assert.equal(
    f.files.files.size,
    1,
    "committed source retained despite lost ACK",
  );
  mutable.transaction = real as any;
  assert.equal((await f.call(url, f.mgr, "POST", body)).data.replayed, true);
  assert.equal(f.files.files.size, 1);
  const race = await Promise.all(
    [1, 2].map(() => f.call(url, f.mgr, "POST", payload(raw("VG", "HDKT"), 1))),
  );
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(f.files.files.size, 2);
  assert.equal(
    (await f.call("/contract-templates/VG", f.mgr)).status,
    409,
    "old client cannot edit another source silently",
  );
  const rows = await f.db.select().from(contractTemplateSources);
  assert.equal(rows.length, 2);
});

test("audit hoặc storage lỗi không công bố phiên bản; migration gate chạy READ ONLY và chặn mất RLS", async () => {
  const f = await setupLiquidation(),
    url = "/contract-template-sources/BN/BBNT",
    body = payload(raw("BN", "BBNT"));
  await f.client.exec(
    "CREATE FUNCTION reject_source_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='template-source-upload' THEN RAISE EXCEPTION 'fixture audit fail'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_source_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_source_audit();",
  );
  assert.equal((await f.call(url, f.mgr, "POST", body)).status, 500);
  assert.equal(f.files.files.size, 0);
  assert.equal((await f.db.select().from(contractTemplateSources)).length, 0);
  await f.client.exec("DROP TRIGGER reject_source_audit ON audit_logs");
  const put = f.files.put;
  f.files.put = async () => {
    throw Error("fixture storage fail");
  };
  assert.equal((await f.call(url, f.mgr, "POST", body)).status, 500);
  assert.equal((await f.db.select().from(contractTemplateSources)).length, 0);
  f.files.put = put;
  const gate = readFileSync(
      "scripts/sql/assert-contract-template-sources.sql",
      "utf8",
    ),
    migration = readFileSync(
      "migrations/postgres/20261124045004_contract_template_sources.sql",
      "utf8",
    );
  await f.client.exec("BEGIN READ ONLY;" + gate + "ROLLBACK;");
  await f.client.exec(migration);
  await f.client.exec(
    "BEGIN;ALTER TABLE sales_contract_template_sources DISABLE ROW LEVEL SECURITY;",
  );
  await assert.rejects(f.client.exec(gate), /RLS/);
  await f.client.exec("ROLLBACK");
});
