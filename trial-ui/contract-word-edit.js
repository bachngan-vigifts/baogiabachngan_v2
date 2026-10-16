/* Paragraph/cell editing retains the DOCX package, tables and untouched formatting. */
globalThis.ContractWordEdit=(()=>{
 const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const serialize=node=>new XMLSerializer().serializeToString(node);
 const editable=p=>!['drawing','pict','fldChar','fldSimple','object','sdt'].some(tag=>p.getElementsByTagNameNS(W,tag).length)&&p.getElementsByTagNameNS(W,'t').length>0;
 function open(bytes){const files=globalThis.fflate.unzipSync(new Uint8Array(bytes)),raw=globalThis.fflate.strFromU8(files['word/document.xml']);const xml=new DOMParser().parseFromString(raw,'application/xml');if(xml.getElementsByTagName('parsererror').length)throw Error('Không đọc được nội dung Word.');return {files,xml,paragraphs:Array.from(xml.getElementsByTagNameNS(W,'p'))};}
 function pack(files,xml){files['word/document.xml']=globalThis.fflate.strToU8(serialize(xml));return globalThis.fflate.zipSync(files,{level:6});}
 // Sửa trực tiếp trên DOM của document.xml. Đoạn bị xoá hết chữ thì XOÁ HẲN đoạn đó (không để lại dòng trống);
 // riêng đoạn duy nhất trong một ô bảng thì giữ (Word bắt buộc ô có ít nhất một đoạn) nhưng để trống.
 async function applyTo(xml,paragraphs,edits){
  const removed=new Set();
  for(const edit of edits){const p=paragraphs[edit.index];if(!p||!editable(p)||await digest(serialize(p))!==edit.hash)throw Error('Mẫu hoặc dữ liệu HĐKT đã thay đổi. Cần bỏ bản chỉnh văn bản cũ để dựng lại từ dữ liệu mới.');
   const parent=p.parentNode,onlyInCell=parent?.localName==='tc'&&Array.from(parent.childNodes).filter(n=>n.localName==='p').length===1;
   // Dòng trống trong chữ đã sửa (Enter thừa, xoá hết chữ một dòng): bản xem không hiện nhưng Word in thành dòng trắng → bỏ.
   const text=String(edit.text??'').replace(/\r/g,'').split('\n').map(line=>line.replace(/\s+$/,'')).filter(line=>line.trim()).join('\n');
   if(!text&&!onlyInCell){removed.add(edit.index);continue;}
   const oldProps=p.getElementsByTagNameNS(W,'rPr')[0]?.cloneNode(true);
   const pPr=Array.from(p.childNodes).find(n=>n.localName==='pPr')?.cloneNode(true)||xml.createElementNS(W,'w:pPr');
   while(p.firstChild)p.removeChild(p.firstChild);p.appendChild(pPr);
   if(edit.align){for(const n of Array.from(pPr.childNodes))if(n.localName==='jc')pPr.removeChild(n);const jc=xml.createElementNS(W,'w:jc');jc.setAttributeNS(W,'w:val',edit.align);pPr.appendChild(jc);}
   const r=xml.createElementNS(W,'w:r'),props=oldProps||xml.createElementNS(W,'w:rPr');
   for(const [key,tag] of [['bold','b'],['italic','i'],['underline','u']])if(typeof edit[key]==='boolean'){for(const n of Array.from(props.childNodes))if(n.localName===tag)props.removeChild(n);const n=xml.createElementNS(W,'w:'+tag);n.setAttributeNS(W,'w:val',edit[key]?(tag==='u'?'single':'1'):(tag==='u'?'none':'0'));props.appendChild(n);}
   r.appendChild(props);text.split('\n').forEach((line,i)=>{if(i)r.appendChild(xml.createElementNS(W,'w:br'));const t=xml.createElementNS(W,'w:t');t.setAttribute('xml:space','preserve');t.appendChild(xml.createTextNode(line));r.appendChild(t);});p.appendChild(r);
  }
  // Xoá sau cùng: các đoạn khác vẫn so khớp đúng theo vị trí ban đầu.
  for(const index of removed)paragraphs[index].parentNode.removeChild(paragraphs[index]);
  return removed;
 }
 async function apply(bytes,edits=[]){
  if(!edits.length)return bytes;const {files,xml,paragraphs}=open(bytes);
  await applyTo(xml,paragraphs,edits);return pack(files,xml);
 }
 async function prepare(bytes,edits=[]){
  const {files,xml,paragraphs}=open(bytes),info=[];
  for(const [index,p] of paragraphs.entries())if(editable(p))info.push({index,hash:await digest(serialize(p))});
  const removed=await applyTo(xml,paragraphs,edits),saved=edits.length?pack(files,xml):bytes;
  // Đánh dấu (bookmark) từng đoạn sửa được trên CHÍNH bản đã áp chỉnh sửa – đánh theo vị trí gốc nên không lệch khi có đoạn bị xoá.
  const visible=info.filter(x=>!removed.has(x.index));
  for(const {index} of visible){const p=paragraphs[index],mark=xml.createElementNS(W,'w:bookmarkStart');mark.setAttributeNS(W,'w:name','bnword_'+index);mark.setAttributeNS(W,'w:id',String(900000+index));p.appendChild(mark);const end=xml.createElementNS(W,'w:bookmarkEnd');end.setAttributeNS(W,'w:id',String(900000+index));p.appendChild(end);}
  return {bytes:saved,preview:pack(files,xml),paragraphs:visible};
 }
 return {apply,prepare};
})();
