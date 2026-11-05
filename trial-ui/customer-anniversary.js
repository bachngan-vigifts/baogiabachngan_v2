// TỰ SINH bởi `npm run ui:build` từ src/modules/customers/domain/anniversary.ts – không sửa tay.
// src/modules/customers/domain/anniversary.ts
var ANNIVERSARY_INTERVAL = 5;
var ANNIVERSARY_LEAD_DAYS = 60;
var vietnamToday = (now = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(now);
function isCalendarDate(value) {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = /* @__PURE__ */ new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function anniversarySuggestion(establishedDate, today = vietnamToday()) {
  if (!isCalendarDate(establishedDate) || !isCalendarDate(today) || establishedDate > today) return null;
  const startYear = Number(establishedDate.slice(0, 4)), currentYear = Number(today.slice(0, 4));
  let years = Math.max(ANNIVERSARY_INTERVAL, Math.ceil((currentYear - startYear) / ANNIVERSARY_INTERVAL) * ANNIVERSARY_INTERVAL);
  const anniversaryDate = (year) => {
    if (year > 9999) return null;
    const date2 = String(year).padStart(4, "0") + establishedDate.slice(4);
    return isCalendarDate(date2) ? date2 : String(year).padStart(4, "0") + "-02-28";
  };
  let date = anniversaryDate(startYear + years);
  if (date && date < today) {
    years += ANNIVERSARY_INTERVAL;
    date = anniversaryDate(startYear + years);
  }
  if (!date) return null;
  const daysUntil = Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5);
  return {
    years,
    date,
    daysUntil,
    upcoming: daysUntil <= ANNIVERSARY_LEAD_DAYS,
    suggestion: `K\u1EF7 ni\u1EC7m ${years} n\u0103m th\xE0nh l\u1EADp: ch\u1EE7 \u0111\u1ED9ng li\xEAn h\u1EC7, t\xECm hi\u1EC3u k\u1EBF ho\u1EA1ch s\u1EF1 ki\u1EC7n v\xE0 t\u01B0 v\u1EA5n qu\xE0 t\u1EB7ng / \u1EA5n ph\u1EA9m k\u1EF7 ni\u1EC7m.`
  };
}
export {
  ANNIVERSARY_INTERVAL,
  ANNIVERSARY_LEAD_DAYS,
  anniversarySuggestion,
  isCalendarDate,
  vietnamToday
};
