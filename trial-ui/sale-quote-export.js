import {after,discounted} from './quote-math.js';
import {resources} from './stock-shortage-pdf.js';
import {SALE_LAYOUT_COLUMNS,saleDesignProblem,saleProductDescription} from './sale-quote-layout.js';
export const SALE_EXPORT_COLUMNS = [...SALE_LAYOUT_COLUMNS];
/** Public-field allowlist: Sale product SKU/specifications are allowed; private costs, internal record IDs and signed URLs are never copied. */
export function saleExportRows(state) {
  if (!state.rows?.length) throw Error('Chưa có sản phẩm để xuất báo giá Sale.');
  const problem=saleDesignProblem(state);if(problem)throw Error(problem);
  return state.rows.map((row,index)=>{
    const quantity=Number(row.qty),unitPrice=discounted(row),printFee=state.type==='HRC'?0:Number(row.printFee||0),amount=after(row,state)*quantity;
    if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0||!Number.isFinite(printFee)||printFee<0||!Number.isFinite(amount))throw Error(`Số lượng hoặc đơn giá dòng ${index+1} không hợp lệ.`);
    const average=typeof row.suggestedAverage==='number'&&Number.isFinite(row.suggestedAverage)&&row.suggestedAverage>=0?row.suggestedAverage:null;
    return{index:index+1,name:state.template==='sale'?saleProductDescription(row):String(row.name||''),quantity,average,unitPrice,printFee,amount};
  });
}
function requiredImages(state,images){if(state.template==='sale'&&state.rows.some((_,i)=>!images[i]?.dataUrl))throw Error('Không tải đủ ảnh thiết kế. Mở lại báo giá hoặc đính kèm lại ảnh rồi xuất file.');}
const cells=row=>[row.index,'',row.name,row.quantity,row.average,row.unitPrice,row.printFee,row.amount];
export async function buildSalePdf(state,assets,{images=[],banner}={}){
 const rows=saleExportRows(state);requiredImages(state,images);
 if(!banner)throw Error('Chưa tải được tiêu đề Vigifts. Tải lại trang rồi xuất PDF Sale.');
 if(!globalThis.EditableQuotePdf)throw Error('Chưa tải được mẫu PDF. Tải lại trang rồi thử lại.');
 return globalThis.EditableQuotePdf.create({state,images,banner,saleRows:rows,saleColumns:SALE_EXPORT_COLUMNS,resources:assets});
}
export function buildSaleWorkbook(state,ExcelJS,{images=[]}={}){
 const rows=saleExportRows(state);requiredImages(state,images);const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Bao gia Sale');
 [7,16,60,12,26,22,18,25].forEach((width,i)=>sheet.getColumn(i+1).width=width);sheet.addRow(SALE_EXPORT_COLUMNS);
 for(const row of rows)sheet.addRow(cells(row));
 sheet.eachRow((row,i)=>{
  row.eachCell({includeEmpty:true},(cell,col)=>{cell.font={name:'Arial',size:11,bold:i===1};cell.alignment={vertical:'middle',horizontal:col>=4?'right':'left',wrapText:i===1||col===3};if(i===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'EAF1FB'}};if(i>1&&col>=4)cell.numFmt='#,##0.######';});
  row.height=i===1?40:Math.max(64,String(row.getCell(3).value||'').split(/\r?\n/).reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/50)),0)*15+6);
 });
 images.forEach((image,i)=>{if(!image?.dataUrl)return;const id=book.addImage({base64:image.dataUrl,extension:image.dataUrl.startsWith('data:image/png')?'png':'jpeg'}),w0=image.width||1,h0=image.height||1,ratio=Math.min(100/w0,72/h0),w=w0*ratio,h=h0*ratio;
  sheet.addImage(id,{tl:{nativeCol:1,nativeRow:i+1,nativeColOff:Math.round((112-w)/2*9525),nativeRowOff:Math.round((sheet.getRow(i+2).height*96/72-h)/2*9525)},ext:{width:w,height:h},editAs:'oneCell'});
 });
 sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'H'+(rows.length+1)};sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:'A1:H'+(rows.length+1),printTitlesRow:'1:1'};return book;
}
export async function salePdfBytes(state,options){return buildSalePdf(state,await resources(),options);}
export async function saleExcelBytes(state,options){await globalThis.QuoteExcel.ready();return buildSaleWorkbook(state,globalThis.ExcelJS,options).xlsx.writeBuffer();}
/** Decode only already-loaded images. No external URLs, tokens or scripts are copied into either file. */
export function canvasExportImages(images){return images.map(image=>{
 if(!image)return null;const canvas=document.createElement('canvas'),w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,ratio=Math.min(1,1000/Math.max(w,h));canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);return{dataUrl:canvas.toDataURL('image/jpeg',.9),width:canvas.width,height:canvas.height};
});}
