let ready;
export async function downloadAccountingTemplate() {
  if (!globalThis.XLSX) await (ready ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./xlsx.full.min.js', import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => { ready = null; script.remove(); reject(Error('Không tải được công cụ tạo mẫu Excel.')); };
    document.head.append(script);
  }));
  const x = globalThis.XLSX, sheet = x.utils.aoa_to_sheet([['SKU', 'SL'], ['00123', 10]]);
  sheet.A2.z = '@'; sheet['!cols'] = [{ wch: 32 }, { wch: 16 }];
  const book = x.utils.book_new(); x.utils.book_append_sheet(book, sheet, 'Ton dau ky');
  x.writeFile(book, 'mau-ton-ke-toan-SKU-SL.xlsx');
}
