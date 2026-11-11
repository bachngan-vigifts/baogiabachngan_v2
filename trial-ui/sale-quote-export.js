import {after} from './quote-math.js';
import {resources} from './stock-shortage-pdf.js';

export const SALE_EXPORT_COLUMNS = ['STT', 'Tên sản phẩm', 'Số lượng', 'Đơn giá', 'Thành tiền'];
/** Allowlist, never copy source rows: exported files must not contain hidden quote data. */
export function saleExportRows(state) {
  if (!state.rows?.length) throw Error('Chưa có sản phẩm để xuất báo giá Sale.');
  return state.rows.map((row, index) => {
    const quantity = Number(row.qty), unitPrice = after(row, state), amount = unitPrice * quantity;
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(amount)) throw Error(`Số lượng hoặc đơn giá dòng ${index + 1} không hợp lệ.`);
    return {index: index + 1, name: String(row.name || ''), quantity, unitPrice, amount};
  });
}
const formatted = n => Number(n).toLocaleString('vi-VN', {maximumFractionDigits: 6});

export async function buildSalePdf(state, assets) {
  const rows = saleExportRows(state), {PDFLib, fontkit, fonts} = assets;
  const pdf = await PDFLib.PDFDocument.create(); pdf.registerFontkit(fontkit);
  const normal = await pdf.embedFont(fonts[0], {subset: true}), bold = await pdf.embedFont(fonts[1], {subset: true});
  const widths = [30, 263, 58, 82, 90], left = 36, bottom = 52, size = 10, step = 13;
  let page, y;
  const draw = (text, x, top, font=normal, fontSize=size) => page.drawText(String(text), {x, y:top-fontSize, font, size:fontSize});
  function newPage() {
    page = pdf.addPage([595.28, 841.89]);
    draw('BÁO GIÁ CHO SALE', left, 805, bold, 15);
    let x=left;
    SALE_EXPORT_COLUMNS.forEach((label,i)=>{draw(label,x+4,775,bold,9);x+=widths[i];});
    page.drawLine({start:{x:left,y:756},end:{x:559,y:756},thickness:0.6});y=744;
  }
  function wrap(value, width) {
    const lines=[];let line='';
    for(const char of String(value).replace(/\s+/g,' ').trim()){
      if(normal.widthOfTextAtSize(line+char,size)>width&&line){lines.push(line);line='';}
      line+=char;
    }
    if(line||!lines.length)lines.push(line);return lines;
  }
  newPage();
  for(const row of rows){
    const cells=[row.index,row.name,formatted(row.quantity),formatted(row.unitPrice),formatted(row.amount)].map((v,i)=>wrap(v,widths[i]-8));
    const count=Math.max(...cells.map(c=>c.length));let offset=0;
    while(offset<count){
      if(y<bottom+step+8)newPage();
      const take=Math.min(count-offset,Math.max(1,Math.floor((y-bottom-8)/step))), height=Math.max(25,take*step+8);
      let x=left;
      cells.forEach((lines,i)=>{
        lines.slice(offset,offset+take).forEach((text,j)=>draw(text,i>=2?x+widths[i]-4-normal.widthOfTextAtSize(text,size):x+4,y-j*step));x+=widths[i];
      });
      page.drawLine({start:{x:left,y:y-height+4},end:{x:559,y:y-height+4},thickness:0.35,color:PDFLib.rgb(.8,.82,.85)});
      y-=height;offset+=take;if(offset<count)newPage();
    }
  }
  const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText(`${i+1}/${pages.length}`,{x:525,y:25,font:normal,size:9}));
  pdf.setTitle('Báo giá cho Sale');pdf.setSubject('STT, tên sản phẩm, số lượng, đơn giá, thành tiền');
  return pdf.save();
}

export function buildSaleWorkbook(state, ExcelJS) {
  const rows=saleExportRows(state),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Bao gia Sale');
  [7,64,14,22,25].forEach((width,i)=>{sheet.getColumn(i+1).width=width;});
  sheet.addRow(SALE_EXPORT_COLUMNS);
  for(const row of rows)sheet.addRow([row.index,row.name,row.quantity,row.unitPrice,row.amount]);
  sheet.eachRow((row,i)=>{
    row.eachCell({includeEmpty:true},(cell,col)=>{
      cell.font={name:'Arial',size:11,bold:i===1};
      cell.alignment={vertical:'middle',horizontal:col>=3?'right':'left',wrapText:col===2};
      if(i===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'EAF1FB'}};
      if(i>1&&col>=3)cell.numFmt='#,##0.######';
    });
    row.height=i===1?28:Math.max(24,Math.ceil(String(row.getCell(2).value||'').length/55)*15+6);
  });
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'E'+(rows.length+1)};
  sheet.pageSetup={paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:'A1:E'+(rows.length+1),printTitlesRow:'1:1'};
  return book;
}
export async function salePdfBytes(state) { return buildSalePdf(state,await resources()); }
export async function saleExcelBytes(state) {
  await globalThis.QuoteExcel.ready();
  return buildSaleWorkbook(state,globalThis.ExcelJS).xlsx.writeBuffer();
}
