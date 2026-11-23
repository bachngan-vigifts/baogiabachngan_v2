import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInThisContext} from 'node:vm';

const ui=new URL('../../trial-ui/',import.meta.url);
runInThisContext(readFileSync(new URL('fflate.min.js',ui),'utf8'));
runInThisContext(readFileSync(process.env.CONTRACT_DOCUMENT_SOURCE||new URL('contract-document.js',ui),'utf8'));
const g=globalThis as unknown as {
 fflate:{unzipSync(b:Uint8Array):Record<string,Uint8Array>;strFromU8(b:Uint8Array):string;strToU8(s:string):Uint8Array;zipSync(f:Record<string,Uint8Array>):Uint8Array};
 ContractDocument:{build(o:unknown):Promise<Uint8Array>;formatProductTable(bytes:Uint8Array,items?:unknown[]):Promise<Uint8Array>};
};
const text=(xml:string)=>[...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(m=>m[1]).join('');
const xmlOf=(bytes:Uint8Array)=>g.fflate.strFromU8(g.fflate.unzipSync(bytes)['word/document.xml']!);
const tableOf=(source:string)=>(source.match(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g)||[]).find(t=>/STT/.test(text(t))&&/Thành\s*[Tt]iền/.test(text(t)))!;
const rowsOf=(source:string)=>tableOf(source).match(/<w:tr\b[\s\S]*?<\/w:tr>/g)!;
const items=[
 {name:'Ly',unit:'Cái',quantity:2,price_after_discount:1000.25,line_total:2000.5,tax_percent:8},
 {name:'Bộ trà',unit:'Bộ',quantity:3,price_after_discount:2000,line_total:6000,tax_percent:8},
 {name:'Dòng cũ thiếu ĐVT',quantity:4,price_after_discount:1000,line_total:4000,tax_percent:8},
 {name:'Khay',unit:'Thùng & <Khay>',quantity:5,price_after_discount:1000,line_total:5000,tax_percent:8},
];

for(const brand of ['bach-ngan','vigifts'])for(const file of ['hdkt','bien-ban','shared']){
 test(`${brand}/${file}: header trắng, ĐVT theo dòng, không đoán đơn vị và giữ nguyên tiền`,async()=>{
  const output=await g.ContractDocument.build({
   quote:{quote_type:brand==='vigifts'?'VIGIFTS':'B2B',quote_date:'2026-11-23',customer:{name:'Khách thử'},items,subtotal:17000.5,vat_amount:1360,total:18361},
   templateBytes:readFileSync(new URL(file==='shared'?'mau-bien-ban-ban-giao-nghiem-thu.docx':`mau-hop-dong-${brand}-${file}.docx`,ui)),
   documentType:file==='hdkt'?'HDKT':'BBNT',contractNumber:'LOCAL-UNITS',details:{depositRate:30,paymentDays:5},
  });
  const source=xmlOf(output),rows=rowsOf(source),header=rows[0]!;
  assert.doesNotMatch(header,/<w:shd\b[^>]*w:fill="(?!FFFFFF|ffffff|auto)[^"]+"/,'không nền xám/đen');
  assert.doesNotMatch(text(header),/Số\s*lượng\s*\(\s*Bộ\s*\)/i);
  const cells=rows.slice(1,5).map(row=>[...row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(c=>text(c[0])));
  const quantityColumn=[...header.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].findIndex(c=>/Số\s*lượng/i.test(text(c[0])));
  assert.deepEqual(cells.map(c=>c[quantityColumn]),['2 Cái','3 Bộ','4','5 Thùng &amp; &lt;Khay&gt;']);
  assert.match(source,/1\.000,25/);
  assert.ok(text(rows[1]!).includes(file==='hdkt'?'2.001':'2.161'),'thành tiền giữ cơ sở VAT của mẫu');
  // The legacy standalone handover templates have no order-total rows;
  // production BBNT gets those by copying the complete HĐKT table.
  if(file==='hdkt')assert.match(source,/18\.361/);
  assert.ok(header.includes('<w:b'),'giữ chữ đậm');assert.match(tableOf(source),/<w:tblBorders/);
 });
}

test('product table formatting is idempotent and leaves source bytes, other tables and paragraphs intact',async()=>{
 const cell=(s:string)=>`<w:tc><w:tcPr><w:shd w:fill="B7B7B7"/></w:tcPr><w:p><w:r><w:t>${s}</w:t></w:r></w:p></w:tc>`;
 const other=`<w:tbl><w:tr>${cell('Bảng tài khoản không đổi')}</w:tr></w:tbl>`;
 const source=`<w:document><w:body>${other}<w:tbl><w:tr>${['STT','Tên sản phẩm','Số lượng (Bộ)','Thành tiền'].map(cell).join('')}</w:tr><w:tr>${['1','Ly','2','2.000'].map(cell).join('')}</w:tr></w:tbl><w:p><w:r><w:t>Điều khoản giữ nguyên</w:t></w:r></w:p></w:body></w:document>`;
 const bytes=g.fflate.zipSync({'word/document.xml':g.fflate.strToU8(source)}),copy=bytes.slice();
 const first=await g.ContractDocument.formatProductTable(bytes,items),second=await g.ContractDocument.formatProductTable(first,items);
 assert.equal(xmlOf(first),xmlOf(second));assert.deepEqual(bytes,copy);
 assert.ok(xmlOf(first).includes(other));assert.match(xmlOf(first),/Điều khoản giữ nguyên/);
 assert.equal((xmlOf(first).match(/<w:p>/g)||[]).length,(source.match(/<w:p>/g)||[]).length);
});

test('lazy ZIP path and fallback produce identical XML, preserving every non-document entry byte for byte',async()=>{
 const bytes=readFileSync(new URL('mau-hop-dong-bach-ngan-hdkt.docx',ui));
 const fallback=await g.ContractDocument.formatProductTable(bytes,items);
 runInThisContext(readFileSync(new URL('jszip.min.js',ui),'utf8'));
 try{
  const output=await g.ContractDocument.formatProductTable(bytes,items),before=g.fflate.unzipSync(bytes),after=g.fflate.unzipSync(output);
  assert.equal(xmlOf(output),xmlOf(fallback));assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort());
  for(const path of Object.keys(before))if(path!=='word/document.xml')assert.deepEqual(after[path],before[path],path);
 }finally{delete (globalThis as unknown as {JSZip?:unknown}).JSZip;}
});

test('editable STT never selects another product unit',async()=>{
 const cell=(value:string)=>`<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
 const row=(values:string[])=>'<w:tr>'+values.map(cell).join('')+'</w:tr>';
 const source='<w:document><w:body><w:tbl>'+row(['STT','Sản phẩm','Số lượng (Bộ)','Thành tiền'])+row(['99','Ly','2','2.000'])+row(['99','Bộ trà','3','6.000'])+'</w:tbl></w:body></w:document>';
 const output=await g.ContractDocument.formatProductTable(g.fflate.zipSync({'word/document.xml':g.fflate.strToU8(source)}),items);
 assert.ok(text(rowsOf(xmlOf(output))[1]!).includes('2 Cái'));
 assert.ok(text(rowsOf(xmlOf(output))[2]!).includes('3 Bộ'));
});
