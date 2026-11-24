import { Unzip, UnzipInflate } from "fflate";
import { SaxesParser } from "saxes";
import { MAX_TEMPLATE_BYTES } from "../../../core/contracts/contract-template-source.ts";
export { MAX_TEMPLATE_BYTES };
const MAX_EXPANDED = 8 * 1024 * 1024,
  MAX_XML = 1024 * 1024;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function directoryOf(bytes: Uint8Array, fail: (message: string) => never) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) fail("Gói Word ZIP bị cắt hoặc không hợp lệ.");
  const count = view.getUint16(end + 10, true),
    start = view.getUint32(end + 16, true),
    size = view.getUint32(end + 12, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    !count ||
    count > 128 ||
    start + size !== end
  )
    fail("Gói Word ZIP không hỗ trợ hoặc quá nhiều mục.");
  const entries = new Map<string, { size: number; crc: number }>();
  let at = start;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50)
      fail("Thư mục ZIP không hợp lệ.");
    const nameSize = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true),
      next = at + 46 + nameSize + extra + comment,
      local = view.getUint32(at + 42, true),
      compressed = view.getUint32(at + 20, true),
      expanded = view.getUint32(at + 24, true),
      method = view.getUint16(at + 10, true);
    if (
      next > end ||
      local + 30 > start ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(at + 8, true) & 1 ||
      view.getUint16(local + 6, true) & 1 ||
      ![0, 8].includes(method) ||
      view.getUint16(local + 8, true) !== method ||
      expanded > MAX_EXPANDED
    )
      fail("Gói Word mã hoá, hỏng hoặc giải nén quá lớn.");
    const localSize = view.getUint16(local + 26, true),
      data = local + 30 + localSize + view.getUint16(local + 28, true);
    if (
      localSize !== nameSize ||
      data + compressed > start ||
      data < local ||
      view.getUint16(at + 34, true)
    )
      fail("Kích thước gói Word không hợp lệ.");
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameSize));
    if (
      decoder.decode(bytes.subarray(local + 30, local + 30 + localSize)) !==
        name ||
      entries.has(name)
    )
      fail("Tên mục ZIP bị trùng hoặc không nhất quán.");
    entries.set(name, { size: expanded, crc: view.getUint32(at + 16, true) });
    at = next;
  }
  if (at !== end) fail("Thư mục ZIP không đầy đủ.");
  return entries;
}
/** Validate before preview or storage. Feed small compressed chunks to bound inflater work/memory. */
export function validateTemplateSource(
  bytes: Uint8Array,
  required: string[],
  requireGoodsTable = false,
) {
  let failure: Error | undefined;
  const fail = (message: string): never => {
    failure ||= new Error(message);
    throw failure;
  };
  if (!bytes.length || bytes.length > MAX_TEMPLATE_BYTES)
    fail("Mẫu Word tối đa 3 MB.");
  const directory = directoryOf(bytes, fail);
  let fieldText = "",
    hasGoodsTable = false;
  const tables: Array<{ seen: boolean; open: boolean; text: string }> = [];
  let expanded = 0,
    entries = 0,
    documentText = "",
    hasTypes = false,
    hasDocument = false,
    hasMainType = false,
    hasWordRoot = false,
    paragraph = "",
    inText = false;
  const names = new Set<string>();
  const unzip = new Unzip((file) => {
    if (
      ++entries > 128 ||
      names.has(file.name) ||
      file.name.startsWith("/") ||
      file.name.includes("\\") ||
      file.name.split("/").includes("..") ||
      /[\u0000-\u001f]/.test(file.name)
    )
      fail("Gói Word có đường dẫn hoặc mục trùng không hợp lệ.");
    names.add(file.name);
    const expected = directory.get(file.name);
    if (!expected) fail("Mục ZIP không thuộc thư mục gốc.");
    let actualSize = 0,
      crc = 0xffffffff;
    if (/vba|activex|embeddings|\.html?$|\.exe$|\.js$/i.test(file.name))
      fail("Mẫu Word không được chứa macro, chương trình hoặc tệp nhúng.");
    if (file.originalSize && file.originalSize > MAX_EXPANDED)
      fail("Mẫu Word giải nén quá lớn.");
    const isXml = /\.xml$|\.rels$/i.test(file.name),
      decoder = new TextDecoder("utf-8", { fatal: true });
    let xmlSize = 0,
      depth = 0,
      finalized = false;
    const parser = isXml ? new SaxesParser({ xmlns: true }) : null;
    parser?.on("doctype", () => {
      fail("Mẫu Word không được chứa DTD/entity ngoài.");
    });
    parser?.on("error", () => {
      fail("XML trong mẫu Word không hợp lệ.");
    });
    parser?.on("opentag", (tag) => {
      if (file.name === "word/document.xml" && tag.uri === W) {
        if (tag.local === "tbl")
          tables.push({ seen: false, open: false, text: "" });
        if (
          tag.local === "tr" &&
          tables.length &&
          !tables[tables.length - 1]!.seen
        ) {
          tables[tables.length - 1]!.seen = true;
          tables[tables.length - 1]!.open = true;
        }
      }
      if (++depth > 128) fail("XML của mẫu Word lồng quá sâu.");
      if (file.name === "[Content_Types].xml" && tag.local === "Override") {
        const attrs = Object.fromEntries(
          Object.values(tag.attributes).map((a) => [a.local, a.value]),
        );
        if (
          attrs.PartName === "/word/document.xml" &&
          attrs.ContentType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
        )
          hasMainType = true;
      }
      if (
        file.name === "word/document.xml" &&
        tag.local === "document" &&
        tag.uri === W
      )
        hasWordRoot = true;
      if (
        Object.values(tag.attributes).some((a) =>
          /macroEnabled|vbaProject|oleObject|activeX|aFChunk/i.test(a.value),
        )
      )
        fail("Mẫu Word chứa macro hoặc đối tượng nhúng không hỗ trợ.");
      if (
        tag.local === "Relationship" &&
        Object.values(tag.attributes).some(
          (a) =>
            a.local === "TargetMode" &&
            a.value.trim().toLowerCase() === "external",
        )
      )
        fail("Mẫu Word chứa liên kết hoặc tài nguyên ngoài.");
      if (
        tag.local === "Relationship" &&
        Object.values(tag.attributes).some(
          (a) =>
            a.local === "Target" &&
            /^(?:[a-z][a-z0-9+.-]*:|\/\/|\\)/i.test(a.value.trim()),
        )
      )
        fail("Mẫu Word chứa tài nguyên ngoài.");
      if (tag.uri === W && ["object", "altChunk"].includes(tag.local))
        fail("Mẫu Word chứa đối tượng/tệp nhúng không hỗ trợ.");
      if (
        tag.uri === W &&
        tag.local === "fldSimple" &&
        Object.values(tag.attributes).some(
          (a) =>
            a.local === "instr" &&
            /\b(DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|LINK)\b/i.test(a.value),
        )
      )
        fail("Mẫu Word chứa trường liên kết ngoài không hỗ trợ.");
      if (file.name === "word/document.xml" && tag.uri === W) {
        if (tag.local === "p") paragraph = "";
        if (tag.local === "t") inText = true;
      }
      if (tag.uri === W && tag.local === "instrText") inField = true;
    });
    let inField = false;
    parser?.on("text", (text) => {
      if (inField) fieldText += text;
      if (file.name === "word/document.xml" && inText) {
        paragraph += text;
        for (const table of tables) if (table.open) table.text += text;
      }
    });
    parser?.on("closetag", (tag) => {
      depth--;
      if (file.name === "word/document.xml" && tag.uri === W) {
        const table = tables[tables.length - 1];
        if (tag.local === "tr" && table?.open) {
          table.open = false;
          if (/STT/.test(table.text) && /Thành\s*[Tt]iền/.test(table.text))
            hasGoodsTable = true;
        }
        if (tag.local === "tbl") tables.pop();
      }
      if (tag.uri === W) {
        if (tag.local === "instrText") inField = false;
        if (tag.local === "t") inText = false;
        if (file.name === "word/document.xml" && tag.local === "p")
          documentText += paragraph + "\n";
      }
    });
    file.ondata = (error, data, final) => {
      if (error) fail("Không giải nén được mẫu Word.");
      actualSize += data.length;
      for (const byte of data)
        crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
      expanded += data.length;
      if (expanded > MAX_EXPANDED) fail("Mẫu Word giải nén quá lớn.");
      if (parser) {
        xmlSize += data.length;
        if (xmlSize > MAX_XML) fail("XML của mẫu Word quá lớn.");
        parser.write(decoder.decode(data, { stream: !final }));
        if (final) parser.close();
      }
      if (final) {
        if (
          actualSize !== expected!.size ||
          (crc ^ 0xffffffff) >>> 0 !== expected!.crc
        )
          fail("Dữ liệu ZIP không khớp kích thước/checksum.");
        finalized = true;
        if (file.name === "[Content_Types].xml") hasTypes = true;
        if (file.name === "word/document.xml") hasDocument = true;
      }
    };
    completions.push(() => finalized);
    file.start();
  });
  const completions: Array<() => boolean> = [];
  unzip.register(UnzipInflate);
  try {
    for (let i = 0; i < bytes.length; i += 1024)
      unzip.push(
        bytes.subarray(i, Math.min(i + 1024, bytes.length)),
        i + 1024 >= bytes.length,
      );
  } catch (error) {
    fail(error instanceof Error ? error.message : "Mẫu Word không hợp lệ.");
  }
  if (
    !hasTypes ||
    !hasDocument ||
    !hasMainType ||
    !hasWordRoot ||
    names.size !== directory.size ||
    !completions.every((done) => done())
  )
    fail("File không phải mẫu Word DOCX hoàn chỉnh.");
  if (
    /DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|LINK/i.test(
      fieldText.replace(/\s+/g, ""),
    )
  )
    fail("Mẫu Word chứa trường liên kết ngoài.");
  const fields: string[] = [];
  let at = 0;
  for (;;) {
    const start = documentText.indexOf("<<", at);
    if (start < 0) break;
    const end = documentText.indexOf(">>", start + 2);
    if (end < 0 || end - start > 300 || fields.length >= 256)
      fail("Trường tự điền trong mẫu Word không hợp lệ.");
    fields.push(documentText.slice(start, end + 2));
    at = end + 2;
  }
  if (requireGoodsTable && !hasGoodsTable)
    fail("Mẫu cần giữ bảng hàng hoá có tiêu đề STT và Thành tiền.");
  if (
    required.some((field) => !fields.includes(field)) ||
    fields.some((field) => !required.includes(field))
  )
    fail(
      "Mẫu không đúng loại tài liệu hoặc thiếu/thay đổi trường tự điền. Tải file mẫu gốc và giữ nguyên các trường <<…>>.",
    );
  return { fields, expanded, entries };
}
