import {after,discounted} from './quote-math.js';
import {resources} from './stock-shortage-pdf.js';
import {SALE_LAYOUT_COLUMNS,saleDesignProblem} from './sale-quote-layout.js';
export const SALE_EXPORT_COLUMNS = [...SALE_LAYOUT_COLUMNS];
/** Strict allowlist; no catalogue IDs, private costs, customer data or signed URLs in spreadsheet cells. */
export function saleExportRows(state) {
  if (!state.rows?.length) throw Error('Chưa có sản phẩm để xuất báo giá Sale.');
  const problem=saleDesignProblem(state);if(problem)throw Error(problem);
  return state.rows.map((row,index)=>{
    const quantity=Number(row.qty),unitPrice=discounted(row),printFee=state.type==='HRC'?0:Number(row.printFee||0),amount=after(row,state)*quantity;
    if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0||!Number.isFinite(printFee)||printFee<0||!Number.isFinite(amount))throw Error(`Số lượng hoặc đơn giá dòng ${index+1} không hợp lệ.`);
    const average=typeof row.suggestedAverage==='number'&&Number.isFinite(row.suggestedAverage)&&row.suggestedAverage>=0?row.suggestedAverage:null;
    return{index:index+1,name:String(row.name||''),quantity,average,unitPrice,printFee,amount};
  });
}
const formatted=n=>n==null?'—':Number(n).toLocaleString('vi-VN',{maximumFractionDigits:6});
function requiredImages(state,images){if(state.template==='sale'&&state.rows.some((_,i)=>!images[i]?.dataUrl))throw Error('Không tải đủ ảnh thiết kế. Mở lại báo giá hoặc đính kèm lại ảnh rồi xuất file.');}
const cells=row=>[row.index,'',row.name,row.quantity,row.average,row.unitPrice,row.printFee,row.amount];
export async function buildSalePdf(state,assets,{images=[]}={}){
 const rows=saleExportRows(state);requiredImages(state,images);
 const{PDFLib,fontkit,fonts}=assets,pdf=await PDFLib.PDFDocument.create();pdf.registerFontkit(fontkit);
 const normal=await pdf.embedFont(fonts[0],{subset:true}),bold=await pdf.embedFont(fonts[1],{subset:true});
 const widths=[28,82,238,45,106,84,76,110],left=36,bottom=42,size=9,step=12,right=805;
 let page,y;const draw=(text,x,top,font=normal,fontSize=size)=>page.drawText(String(text),{x,y:top-fontSize,font,size:fontSize});
 function wrap(value,width){
  const lines=[];let line='';for(const char of String(value).replace(/\s+/g,' ').trim()){
   if(normal.widthOfTextAtSize(line+char,size)>width&&line){const space=line.lastIndexOf(' ');if(space>line.length/2){lines.push(line.slice(0,space));line=line.slice(space+1);}else{lines.push(line);line='';}}
   line+=char;
  }if(line||!lines.length)lines.push(line);return lines;
 }
 function newPage(){
  page=pdf.addPage([841.89,595.28]);draw('BÁO GIÁ CHO SALE',left,560,bold,15);let x=left;
  SALE_EXPORT_COLUMNS.forEach((label,i)=>{wrap(label,widths[i]-8).forEach((s,j)=>draw(s,x+4,529-j*step,bold));x+=widths[i];});
  page.drawLine({start:{x:left,y:486},end:{x:right,y:486},thickness:.6});y=476;
 }
 const embedded=new Map();newPage();
 for(const [i,row]of rows.entries()){
  const content=cells(row).map((v,j)=>wrap(j>=3?formatted(v):v,widths[j]-8)),count=Math.max(...content.map(c=>c.length));let offset=0;
  let photo=null;const src=images[i]?.dataUrl;
  if(src){if(!embedded.has(src))embedded.set(src,src.startsWith('data:image/png')?await pdf.embedPng(src):await pdf.embedJpg(src));photo=embedded.get(src);}
  while(offset<count){
   if(y<bottom+76)newPage();const take=Math.min(count-offset,Math.max(1,Math.floor((y-bottom-8)/step))),height=Math.max(72,take*step+8);let x=left;
   content.forEach((lines,j)=>{lines.slice(offset,offset+take).forEach((text,k)=>draw(text,j>=3?x+widths[j]-4-normal.widthOfTextAtSize(text,size):x+4,y-k*step));x+=widths[j];});
   if(photo&&offset===0){const ratio=Math.min(74/photo.width,60/photo.height),w=photo.width*ratio,h=photo.height*ratio;page.drawImage(photo,{x:left+widths[0]+(widths[1]-w)/2,y:y-h,width:w,height:h});}
   page.drawLine({start:{x:left,y:y-height+4},end:{x:right,y:y-height+4},thickness:.35,color:PDFLib.rgb(.8,.82,.85)});y-=height;offset+=take;if(offset<count)newPage();
  }
 }
 const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText(`${i+1}/${pages.length}`,{x:770,y:20,font:normal,size:9}));
 pdf.setTitle('Báo giá cho Sale');pdf.setSubject('8 cột: hình thiết kế, giá tham khảo và giá bán');return pdf.save();
}
export function buildSaleWorkbook(state,ExcelJS,{images=[]}={}){
 const rows=saleExportRows(state);requiredImages(state,images);const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Bao gia Sale');
 [7,16,60,12,26,22,18,25].forEach((width,i)=>sheet.getColumn(i+1).width=width);sheet.addRow(SALE_EXPORT_COLUMNS);
 for(const row of rows)sheet.addRow(cells(row));
 sheet.eachRow((row,i)=>{
  row.eachCell({includeEmpty:true},(cell,col)=>{cell.font={name:'Arial',size:11,bold:i===1};cell.alignment={vertical:'middle',horizontal:col>=4?'right':'left',wrapText:i===1||col===3};if(i===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'EAF1FB'}};if(i>1&&col>=4)cell.numFmt='#,##0.######';});
  row.height=i===1?40:Math.max(64,Math.ceil(String(row.getCell(3).value||'').length/50)*15+6);
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
