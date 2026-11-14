/* Paragraph/cell editing retains the DOCX package, tables and untouched formatting. */
globalThis.ContractWordEdit=(()=>{
 const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const serialize=node=>new XMLSerializer().serializeToString(node);
 const editable=p=>!['drawing','pict','fldChar','fldSimple','object','sdt'].some(tag=>p.getElementsByTagNameNS(W,tag).length)&&p.getElementsByTagNameNS(W,'t').length>0;
 function open(bytes){const files=globalThis.fflate.unzipSync(new Uint8Array(bytes)),raw=globalThis.fflate.strFromU8(files['word/document.xml']);const xml=new DOMParser().parseFromString(raw,'application/xml');if(xml.getElementsByTagName('parsererror').length)throw Error('Không đọc được nội dung Word.');return {files,xml,paragraphs:Array.from(xml.getElementsByTagNameNS(W,'p'))};}
 function pack(files,xml){files['word/document.xml']=globalThis.fflate.strToU8(serialize(xml));return globalThis.fflate.zipSync(files,{level:6});}
 const fonts=['Times New Roman','Arial','Calibri','Tahoma'];
 function runProps(xml,old,format){
  const props=old?.cloneNode(true)||xml.createElementNS(W,'w:rPr');
  const set=(tag,attrs)=>{for(const n of Array.from(props.childNodes))if(n.localName===tag)props.removeChild(n);const n=xml.createElementNS(W,'w:'+tag);for(const [k,v]of Object.entries(attrs))n.setAttributeNS(W,'w:'+k,String(v));props.appendChild(n);};
  for(const [key,tag]of [['bold','b'],['italic','i'],['underline','u'],['strike','strike']])if(typeof format[key]==='boolean')set(tag,{val:format[key]?(tag==='u'?'single':'1'):(tag==='u'?'none':'0')});
  if(fonts.includes(format.fontFamily))set('rFonts',{ascii:format.fontFamily,hAnsi:format.fontFamily,eastAsia:format.fontFamily,cs:format.fontFamily});
  if(Number.isFinite(format.fontSize)&&format.fontSize>=6&&format.fontSize<=72){set('sz',{val:Math.round(format.fontSize*2)});set('szCs',{val:Math.round(format.fontSize*2)});}
  if(/^[A-Fa-f0-9]{6}$/.test(format.color||''))set('color',{val:format.color});
  return props;
 }
 function paragraphProps(xml,pPr,edit,numbering){
  const set=(tag,attrs)=>{for(const n of Array.from(pPr.childNodes))if(n.localName===tag)pPr.removeChild(n);const n=xml.createElementNS(W,'w:'+tag);for(const [k,v]of Object.entries(attrs))n.setAttributeNS(W,'w:'+k,String(v));pPr.appendChild(n);return n;};
  if(['left','center','right','both'].includes(edit.align))set('jc',{val:edit.align});
  if([1,1.15,1.5,2].includes(edit.lineSpacing)){let n=Array.from(pPr.childNodes).find(n=>n.localName==='spacing');if(!n){n=xml.createElementNS(W,'w:spacing');pPr.appendChild(n);}n.setAttributeNS(W,'w:line',String(Math.round(edit.lineSpacing*240)));n.setAttributeNS(W,'w:lineRule','auto');}
  if([0,360,720,1080,1440].includes(edit.indent))set('ind',{left:edit.indent});
  if(['none','bullet','decimal'].includes(edit.list)){
   const n=set('numPr',{}),id=xml.createElementNS(W,'w:numId');id.setAttributeNS(W,'w:val',String(edit.list==='none'?0:numbering(edit.list)));n.appendChild(id);
   const level=xml.createElementNS(W,'w:ilvl');level.setAttributeNS(W,'w:val','0');n.insertBefore(level,id);
  }
 }
 function numberingFor(files){
  let xml;
  return kind=>{
   if(!xml){
    xml=new DOMParser().parseFromString(files['word/numbering.xml']?globalThis.fflate.strFromU8(files['word/numbering.xml']):'<w:numbering xmlns:w="'+W+'"/>','application/xml');
    const paths=[['[Content_Types].xml','http://schemas.openxmlformats.org/package/2006/content-types','Override','PartName','/word/numbering.xml',{ContentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'}],['word/_rels/document.xml.rels','http://schemas.openxmlformats.org/package/2006/relationships','Relationship','Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',{Target:'numbering.xml'}]];
    for(const [path,ns,tag,key,value,attrs]of paths){
     const doc=new DOMParser().parseFromString(files[path]?globalThis.fflate.strFromU8(files[path]):'<Relationships xmlns="'+ns+'"/>','application/xml');
     if(!Array.from(doc.documentElement.children).some(n=>n.getAttribute(key)===value)){
      const n=doc.createElementNS(ns,tag);n.setAttribute(key,value);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);
      if(tag==='Relationship'){let i=1;const ids=new Set(Array.from(doc.documentElement.children).map(n=>n.getAttribute('Id')));while(ids.has('rIdBnEditor'+i))i++;n.setAttribute('Id','rIdBnEditor'+i);}doc.documentElement.appendChild(n);files[path]=globalThis.fflate.strToU8(serialize(doc));
     }
    }
   }
   const abstracts=Array.from(xml.getElementsByTagNameNS(W,'abstractNum')),nums=Array.from(xml.getElementsByTagNameNS(W,'num'));
   let a=abstracts.find(n=>Array.from(n.getElementsByTagNameNS(W,'name')).some(x=>x.getAttributeNS(W,'val')==='BachNganEditor-'+kind));
   const element=(tag,attrs={})=>{const n=xml.createElementNS(W,'w:'+tag);for(const [k,v]of Object.entries(attrs))n.setAttributeNS(W,'w:'+k,String(v));return n;};
   if(!a){const id=Math.max(-1,...abstracts.map(n=>Number(n.getAttributeNS(W,'abstractNumId'))))+1;a=element('abstractNum',{abstractNumId:id});a.appendChild(element('multiLevelType',{val:'singleLevel'}));a.appendChild(element('name',{val:'BachNganEditor-'+kind}));const lvl=element('lvl',{ilvl:0});lvl.appendChild(element('start',{val:1}));lvl.appendChild(element('numFmt',{val:kind==='bullet'?'bullet':'decimal'}));lvl.appendChild(element('lvlText',{val:kind==='bullet'?'•':'%1.'}));const pr=element('pPr');pr.appendChild(element('ind',{left:720,hanging:360}));lvl.appendChild(pr);a.appendChild(lvl);xml.documentElement.insertBefore(a,nums[0]||null);}
   const aid=a.getAttributeNS(W,'abstractNumId');let n=nums.find(n=>n.getElementsByTagNameNS(W,'abstractNumId')[0]?.getAttributeNS(W,'val')===aid);
   if(!n){n=element('num',{numId:Math.max(0,...nums.map(n=>Number(n.getAttributeNS(W,'numId'))))+1});n.appendChild(element('abstractNumId',{val:aid}));xml.documentElement.appendChild(n);}files['word/numbering.xml']=globalThis.fflate.strToU8(serialize(xml));return n.getAttributeNS(W,'numId');
  };
 }
 // Sửa trực tiếp trên DOM của document.xml. Đoạn bị xoá hết chữ thì XOÁ HẲN đoạn đó (không để lại dòng trống);
 // riêng đoạn duy nhất trong một ô bảng thì giữ (Word bắt buộc ô có ít nhất một đoạn) nhưng để trống.
 async function applyTo(xml,paragraphs,edits,files){
  const numbering=numberingFor(files);
  const removed=new Set();
  for(const edit of edits){const p=paragraphs[edit.index];if(!p||!editable(p)||await digest(serialize(p))!==edit.hash)throw Error('Mẫu hoặc dữ liệu HĐKT đã thay đổi. Cần bỏ bản chỉnh văn bản cũ để dựng lại từ dữ liệu mới.');
   const parent=p.parentNode,onlyInCell=parent?.localName==='tc'&&Array.from(parent.childNodes).filter(n=>n.localName==='p').length===1;
   // Dòng trống trong chữ đã sửa (Enter thừa, xoá hết chữ một dòng): bản xem không hiện nhưng Word in thành dòng trắng → bỏ.
   const text=String(edit.text??'').replace(/\r/g,'').split('\n').map(line=>line.replace(/\s+$/,'')).filter(line=>line.trim()).join('\n');
   if(!text&&!onlyInCell){removed.add(edit.index);continue;}
   const oldProps=p.getElementsByTagNameNS(W,'rPr')[0]?.cloneNode(true);
   const pPr=Array.from(p.childNodes).find(n=>n.localName==='pPr')?.cloneNode(true)||xml.createElementNS(W,'w:pPr');
   while(p.firstChild)p.removeChild(p.firstChild);p.appendChild(pPr);
   paragraphProps(xml,pPr,edit,numbering);
   const runs=Array.isArray(edit.runs)?edit.runs:null;
   if(runs&&(runs.length>2000||runs.some(r=>!r||typeof r.text!=='string')||runs.map(r=>r.text).join('')!==String(edit.text??'')))throw Error('Định dạng chữ không khớp nội dung đoạn.');
   for(const format of runs||[{...edit,text}]){
    const r=xml.createElementNS(W,'w:r');r.appendChild(runProps(xml,oldProps,format));
    for(const part of format.text.split(/(\n|\t)/)){if(part==='\n'||part==='\t'){r.appendChild(xml.createElementNS(W,part==='\n'?'w:br':'w:tab'));continue;}const t=xml.createElementNS(W,'w:t');t.setAttribute('xml:space','preserve');t.appendChild(xml.createTextNode(part));r.appendChild(t);}p.appendChild(r);
   }
  }
  // Xoá sau cùng: các đoạn khác vẫn so khớp đúng theo vị trí ban đầu.
  for(const index of removed)paragraphs[index].parentNode.removeChild(paragraphs[index]);
  return removed;
 }
 async function apply(bytes,edits=[]){
  if(!edits.length)return bytes;const {files,xml,paragraphs}=open(bytes);
  await applyTo(xml,paragraphs,edits,files);return pack(files,xml);
 }
 async function prepare(bytes,edits=[]){
  const {files,xml,paragraphs}=open(bytes),info=[];
  for(const [index,p] of paragraphs.entries())if(editable(p))info.push({index,hash:await digest(serialize(p))});
  const removed=await applyTo(xml,paragraphs,edits,files),saved=edits.length?pack(files,xml):bytes;
  // Đánh dấu (bookmark) từng đoạn sửa được trên CHÍNH bản đã áp chỉnh sửa – đánh theo vị trí gốc nên không lệch khi có đoạn bị xoá.
  const visible=info.filter(x=>!removed.has(x.index));
  for(const {index} of visible){const p=paragraphs[index],mark=xml.createElementNS(W,'w:bookmarkStart');mark.setAttributeNS(W,'w:name','bnword_'+index);mark.setAttributeNS(W,'w:id',String(900000+index));p.appendChild(mark);const end=xml.createElementNS(W,'w:bookmarkEnd');end.setAttributeNS(W,'w:id',String(900000+index));p.appendChild(end);}
  return {bytes:saved,preview:pack(files,xml),paragraphs:visible};
 }
 // Khi đổi danh xưng/tên đại diện, đoạn Word đã sửa trước đó có hash và chữ cũ.
 // Cập nhật riêng đoạn chứa người đại diện theo bản dựng mới, giữ mọi sửa đổi khác.
 function representativeText(value,details={}){
  const name=String(details.representativeName||'').trim(),honorific=['Ông','Bà'].includes(details.representativeHonorific)?details.representativeHonorific:'';
  if(!name)return String(value??'');
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),prefix=new RegExp('(?:Ông|Bà)\\s*(?='+escaped+')','i'),text=String(value??'');
  return prefix.test(text)?text.replace(prefix,honorific?honorific+' ':''):text;
 }
 async function rebaseRepresentative(bytes,edits=[],details={}){
  const name=String(details.representativeName||'').trim();
  if(!name||!edits.length)return edits;
  const {paragraphs}=open(bytes);
  return Promise.all(edits.map(async edit=>{
   const current=paragraphs[edit.index],text=String(edit.text??'');
   if(!current||!text.toLocaleLowerCase('vi').includes(name.toLocaleLowerCase('vi')))return edit;
   const next=representativeText(text,details),result={...edit,hash:await digest(serialize(current)),text:next};if(next!==text)delete result.runs;return result;
  }));
 }
 // Form fields remain authoritative even when a saved paragraph contains an older date/address.
 const textOf=p=>Array.from(p.getElementsByTagNameNS(W,'t')).map(n=>n.textContent).join('');
 const fieldKind=text=>/^\s*Hôm nay,\s*ngày/i.test(text)?'date':/^\s*5\.2\s*Địa điểm giao hàng\s*:/i.test(text)?'address':/^\s*5\.1\s*Thời gian giao hàng\s*:/i.test(text)?'deliveryTime':/^\s*(?:-\s*Thời hạn thanh toán\s*:|Bên A thanh toán)/i.test(text)?'payment':null;
 async function rebaseFields(bytes,edits=[]){
  if(!edits.length)return edits;
  const {paragraphs}=open(bytes);
  return Promise.all(edits.map(async edit=>{
   const p=paragraphs[edit.index],kind=p&&fieldKind(textOf(p));
   if(!kind||kind!==fieldKind(String(edit.text??'')))return edit;const result={...edit,hash:await digest(serialize(p)),text:textOf(p)};if(result.text!==edit.text)delete result.runs;return result;
  }));
 }
 // A font-only update must not invalidate saved edits in unchanged source paragraphs.
 async function rebaseTypography(oldBytes,newBytes,edits=[]){
  if(!edits.length)return edits;
  const old=open(oldBytes),next=open(newBytes);
  if(old.paragraphs.length!==next.paragraphs.length)throw Error('Số đoạn Word đã thay đổi khi cập nhật phông chữ.');
  return Promise.all(edits.map(async edit=>{
   const from=old.paragraphs[edit.index],to=next.paragraphs[edit.index];
   if(!from||!to||await digest(serialize(from))!==edit.hash)return edit;
   if(textOf(from)!==textOf(to))throw Error('Nội dung Word đã thay đổi khi cập nhật phông chữ.');
   return {...edit,hash:await digest(serialize(to))};
  }));
 }
 const goodsTable=xml=>Array.from(xml.getElementsByTagNameNS(W,'tbl')).find(t=>{
  const row=t.getElementsByTagNameNS(W,'tr')[0],text=row?textOf(row):'';
  return /STT/.test(text)&&/Thành\s*[Tt]iền/.test(text);
 });
 // Carry missing style definitions (including basedOn dependencies) with the copied table.
 function copyTableStyles(target,source,table){
  const path='word/styles.xml';if(!source.files[path]||!target.files[path])return;
  const parse=bytes=>new DOMParser().parseFromString(globalThis.fflate.strFromU8(bytes),'application/xml');
  const from=parse(source.files[path]),to=parse(target.files[path]),styles=Array.from(from.getElementsByTagNameNS(W,'style'));
  const present=new Set(Array.from(to.getElementsByTagNameNS(W,'style')).map(n=>n.getAttributeNS(W,'styleId'))),visiting=new Set();
  const add=id=>{
   if(!id||present.has(id)||visiting.has(id))return;visiting.add(id);
   const style=styles.find(n=>n.getAttributeNS(W,'styleId')===id);if(!style)throw Error('Thiếu định dạng bảng HĐKT: '+id);
   for(const tag of ['basedOn','link','next'])for(const node of style.getElementsByTagNameNS(W,tag))add(node.getAttributeNS(W,'val'));
   to.documentElement.appendChild(to.importNode(style,true));present.add(id);
  };
  for(const tag of ['tblStyle','pStyle','rStyle'])for(const node of table.getElementsByTagNameNS(W,tag))add(node.getAttributeNS(W,'val'));
  target.files[path]=globalThis.fflate.strToU8(serialize(to));
 }
 async function copyContractTable(bytes,contractBytes,edits=[]){
  const target=open(bytes),source=open(contractBytes),oldTable=goodsTable(target.xml),table=goodsTable(source.xml);
  if(!oldTable||!table)throw Error('Không tìm thấy bảng sản phẩm HĐKT để lập biên bản.');
  // These tables contain text and formatting only; external relationships cannot be copied safely.
  if(table.getElementsByTagNameNS(W,'drawing').length||table.getElementsByTagNameNS(W,'hyperlink').length)throw Error('Bảng HĐKT có hình hoặc liên kết cần kiểm tra trước khi sao chép.');
  const oldParagraphs=target.paragraphs,oldHashes=await Promise.all(oldParagraphs.map(p=>digest(serialize(p))));
  const oldInside=oldParagraphs.map(p=>oldTable.contains(p));
  copyTableStyles(target,source,table);
  const copied=target.xml.importNode(table,true);
  if(source.files['word/numbering.xml']){
   const numbering=new DOMParser().parseFromString(globalThis.fflate.strFromU8(source.files['word/numbering.xml']),'application/xml'),assign=numberingFor(target.files);
   for(const ref of copied.getElementsByTagNameNS(W,'numId')){
    const num=Array.from(numbering.getElementsByTagNameNS(W,'num')).find(n=>n.getAttributeNS(W,'numId')===ref.getAttributeNS(W,'val'));
    const aid=num?.getElementsByTagNameNS(W,'abstractNumId')[0]?.getAttributeNS(W,'val'),abstract=Array.from(numbering.getElementsByTagNameNS(W,'abstractNum')).find(n=>n.getAttributeNS(W,'abstractNumId')===aid);
    const name=abstract?.getElementsByTagNameNS(W,'name')[0]?.getAttributeNS(W,'val');
    if(['BachNganEditor-bullet','BachNganEditor-decimal'].includes(name))ref.setAttributeNS(W,'w:val',String(assign(name.slice('BachNganEditor-'.length))));
   }
  }
  oldTable.parentNode.replaceChild(copied,oldTable);
  const paragraphs=Array.from(target.xml.getElementsByTagNameNS(W,'p')),hashes=await Promise.all(paragraphs.map(p=>digest(serialize(p))));
  const locked=paragraphs.flatMap((p,i)=>copied.contains(p)?[i]:[]),normalized=[];
  for(const edit of edits){
   // Already migrated edits are accepted only at their matching paragraph/hash.
   if(hashes[edit.index]===edit.hash){
    if(oldHashes[edit.index]===edit.hash&&!oldInside[edit.index]&&paragraphs.indexOf(oldParagraphs[edit.index])!==edit.index)throw Error('Đoạn biên bản bị trùng vị trí sau đổi bảng. Cần dựng lại biên bản từ HĐKT.');
    if(!locked.includes(edit.index))normalized.push(edit);continue;
   }
   if(oldHashes[edit.index]!==edit.hash)throw Error('Mẫu hoặc dữ liệu biên bản đã thay đổi. Cần dựng lại biên bản từ HĐKT.');
   if(oldInside[edit.index])continue; // The HĐKT owns all product descriptions and money rows.
   const index=paragraphs.indexOf(oldParagraphs[edit.index]);
   if(index<0)throw Error('Không đối chiếu được đoạn biên bản đã sửa.');
   normalized.push({...edit,index,hash:hashes[index]});
  }
  return {base:pack(target.files,target.xml),edits:normalized,locked};
 }
 const formFieldParagraphs=bytes=>open(bytes).paragraphs.flatMap((p,index)=>fieldKind(textOf(p))?[index]:[]);
 return {formatVersion:1,apply,prepare,rebaseTypography,rebaseRepresentative,representativeText,rebaseFields,copyContractTable,formFieldParagraphs};
})();
