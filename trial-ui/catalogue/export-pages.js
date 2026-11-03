/** Page numbers refer to the complete preview, including cover/dividers/closing. */
export function parsePageSelection(text,total){
 if(!Number.isSafeInteger(total)||total<1)throw Error('Báo giá chưa có trang để xuất.');
 const raw=String(text||'').trim().replace(/[–—]/g,'-');
 if(!raw||raw.length>1000)throw Error('Nhập số trang, ví dụ: 1, 3-5.');
 const pages=new Set();
 for(const part of raw.split(',')){
  const match=/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
  if(!match)throw Error('Số trang chưa đúng. Dùng dạng 1, 3-5.');
  const from=Number(match[1]),to=Number(match[2]||match[1]);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<1||to<from||to>total)throw Error('Chỉ chọn trang từ 1 đến '+total+'; khoảng trang phải tăng dần.');
  for(let n=from;n<=to;n++)pages.add(n);
 }
 return [...pages].sort((a,b)=>a-b);
}
