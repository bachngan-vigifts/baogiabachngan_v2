// TỰ SINH bởi `npm run ui:build` từ src/modules/customers/domain/province.ts – không sửa tay.
// src/core/text/fold.ts
var MARKS = "\u0300\u0301\u0302\u0303\u0306\u0309\u031B\u0323";
var FROM = "\xE0\xE1\u1EA1\u1EA3\xE3\xE2\u1EA7\u1EA5\u1EAD\u1EA9\u1EAB\u0103\u1EB1\u1EAF\u1EB7\u1EB3\u1EB5\xE8\xE9\u1EB9\u1EBB\u1EBD\xEA\u1EC1\u1EBF\u1EC7\u1EC3\u1EC5\xEC\xED\u1ECB\u1EC9\u0129\xF2\xF3\u1ECD\u1ECF\xF5\xF4\u1ED3\u1ED1\u1ED9\u1ED5\u1ED7\u01A1\u1EDD\u1EDB\u1EE3\u1EDF\u1EE1\xF9\xFA\u1EE5\u1EE7\u0169\u01B0\u1EEB\u1EE9\u1EF1\u1EED\u1EEF\u1EF3\xFD\u1EF5\u1EF7\u1EF9\u0111" + MARKS;
var TO = "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd";
function fold(value) {
  const lower = String(value ?? "").toLowerCase().normalize("NFC");
  let out = "";
  for (const ch of lower) {
    const i = FROM.indexOf(ch);
    out += i >= 0 ? TO[i] ?? "" : ch;
  }
  return out.trim().replace(/\s+/g, " ");
}

// src/modules/customers/domain/province.ts
var PROVINCES = [
  ["01", "H\xE0 N\u1ED9i", []],
  ["04", "Cao B\u1EB1ng", []],
  ["08", "Tuy\xEAn Quang", ["H\xE0 Giang"]],
  ["11", "\u0110i\u1EC7n Bi\xEAn", []],
  ["12", "Lai Ch\xE2u", []],
  ["14", "S\u01A1n La", []],
  ["15", "L\xE0o Cai", ["Y\xEAn B\xE1i"]],
  ["19", "Th\xE1i Nguy\xEAn", ["B\u1EAFc K\u1EA1n"]],
  ["20", "L\u1EA1ng S\u01A1n", []],
  ["22", "Qu\u1EA3ng Ninh", []],
  ["24", "B\u1EAFc Ninh", ["B\u1EAFc Giang"]],
  ["25", "Ph\xFA Th\u1ECD", ["V\u0129nh Ph\xFAc", "H\xF2a B\xECnh"]],
  ["31", "H\u1EA3i Ph\xF2ng", ["H\u1EA3i D\u01B0\u01A1ng"]],
  ["33", "H\u01B0ng Y\xEAn", ["Th\xE1i B\xECnh"]],
  ["37", "Ninh B\xECnh", ["H\xE0 Nam", "Nam \u0110\u1ECBnh"]],
  ["38", "Thanh H\xF3a", []],
  ["40", "Ngh\u1EC7 An", []],
  ["42", "H\xE0 T\u0129nh", []],
  ["44", "Qu\u1EA3ng Tr\u1ECB", ["Qu\u1EA3ng B\xECnh"]],
  ["46", "Hu\u1EBF", ["Th\u1EEBa Thi\xEAn Hu\u1EBF"]],
  ["48", "\u0110\xE0 N\u1EB5ng", ["Qu\u1EA3ng Nam"]],
  ["51", "Qu\u1EA3ng Ng\xE3i", ["Kon Tum"]],
  ["52", "Gia Lai", ["B\xECnh \u0110\u1ECBnh"]],
  ["56", "Kh\xE1nh H\xF2a", ["Ninh Thu\u1EADn"]],
  ["66", "\u0110\u1EAFk L\u1EAFk", ["Ph\xFA Y\xEAn", "\u0110\u0103k L\u0103k", "Dak Lak"]],
  ["68", "L\xE2m \u0110\u1ED3ng", ["\u0110\u1EAFk N\xF4ng", "B\xECnh Thu\u1EADn"]],
  ["75", "\u0110\u1ED3ng Nai", ["B\xECnh Ph\u01B0\u1EDBc"]],
  ["79", "H\u1ED3 Ch\xED Minh", ["B\xECnh D\u01B0\u01A1ng", "B\xE0 R\u1ECBa V\u0169ng T\xE0u", "HCM", "TPHCM", "S\xE0i G\xF2n"]],
  ["80", "T\xE2y Ninh", ["Long An"]],
  ["82", "\u0110\u1ED3ng Th\xE1p", ["Ti\u1EC1n Giang"]],
  ["86", "V\u0129nh Long", ["B\u1EBFn Tre", "Tr\xE0 Vinh"]],
  ["91", "An Giang", ["Ki\xEAn Giang"]],
  ["92", "C\u1EA7n Th\u01A1", ["H\u1EADu Giang", "S\xF3c Tr\u0103ng"]],
  ["96", "C\xE0 Mau", ["B\u1EA1c Li\xEAu"]]
];
var provinceOptions = PROVINCES.map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
var normalizeAddress = (address) => fold(String(address ?? "").replace(/[\r\n]+/g, ",")).replace(/[.()\-–—/]+/g, " ").replace(/\s+/g, " ").replace(/[,; ]+(viet nam|vietnam|vn)[,; ]*$/, "").replace(/[,; ]+[0-9]{5,6}[,; ]*$/, "").replace(/[,; ]+$/, "").trim();
var provinceAliases = PROVINCES.flatMap(([code, name, old]) => [...new Set([name, ...old].map(normalizeAddress))].map((alias) => ({ code, name, alias })));
var names = provinceAliases.map((p) => p.alias).sort((a, b) => b.length - a.length).join("|");
var provincePattern = `(^|[,;] *)(?:tinh +|tp *|thanh pho +)?(${names})(?=[,;]|$)|(?:^| )(?:tinh +|tp *|thanh pho +)(${names})$`;
function customerProvince(address) {
  const matches = [...normalizeAddress(address).matchAll(new RegExp(provincePattern, "g"))].map((m) => provinceAliases.find((p) => p.alias === (m[2] || m[3]))).filter(Boolean);
  const codes = new Set(matches.map((p) => p.code));
  return codes.size === 1 ? { code: matches[0].code, name: matches[0].name } : null;
}
export {
  PROVINCES,
  customerProvince,
  normalizeAddress,
  provinceAliases,
  provinceOptions,
  provincePattern
};
