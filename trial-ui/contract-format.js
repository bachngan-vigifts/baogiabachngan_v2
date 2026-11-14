// Structured text only: never save HTML, pasted links, images or executable markup.
const FONTS=['Times New Roman','Arial','Calibri','Tahoma'];
const hex=value=>{const m=/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(value);return m?m.slice(1,4).map(n=>Math.min(255,+n).toString(16).padStart(2,'0')).join('').toUpperCase():'000000';};
export function paragraphRuns(p){
 const runs=[],win=p.ownerDocument.defaultView;
 const visit=n=>{
  if(n.nodeType===3){if(!n.textContent)return;const el=n.parentElement,style=win.getComputedStyle(el);let underline=false,strike=false;
   for(let a=el;a&&p.contains(a);a=a.parentElement){const decoration=win.getComputedStyle(a).textDecorationLine;underline ||= decoration.includes('underline');strike ||= decoration.includes('line-through');}
   const family=style.fontFamily.split(',')[0].replace(/["']/g,'').trim();
   const run={text:n.textContent,bold:Number(style.fontWeight)>=600||style.fontWeight==='bold',italic:style.fontStyle==='italic',underline,strike,fontFamily:FONTS.includes(family)?family:'Times New Roman',fontSize:Math.min(72,Math.max(6,Math.round(parseFloat(style.fontSize)*0.75*2)/2)),color:hex(style.color)};
   const prior=runs.at(-1);if(prior&&JSON.stringify({...prior,text:''})===JSON.stringify({...run,text:''}))prior.text+=run.text;else runs.push(run);
  }else if(n.nodeName==='BR'){runs.push({text:'\n'});}else for(const child of n.childNodes)visit(child);
 };
 for(const child of p.childNodes)visit(child);return runs;
}
export function initContractFormatting({host,doc,record,onError}){
 let active=null,selection=null;
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 host.replaceChildren();host.setAttribute('role','group');host.setAttribute('aria-label','Định dạng văn bản');
 const hint=node('p','Bấm vào đoạn văn, bôi đen chữ rồi chọn định dạng. Căn lề, danh sách và giãn dòng áp dụng cho đoạn.');hint.className='small muted cd-format-hint';
 const controls=node('div');controls.className='cd-format-controls';
 const fieldset=node('fieldset');fieldset.disabled=true;fieldset.append(controls);host.append(hint,fieldset);
 const capture=()=>{
  const s=doc.getSelection();if(!s?.rangeCount)return;const r=s.getRangeAt(0),el=n=>n.nodeType===1?n:n.parentElement;
  const a=el(r.startContainer)?.closest('[data-word-index]'),b=el(r.endContainer)?.closest('[data-word-index]');
  if(!a||a!==b){active=null;selection=null;fieldset.disabled=true;hint.textContent='Chọn chữ trong một đoạn có thể sửa để dùng thanh định dạng. Các ô đã khóa lấy theo thông tin nguồn hoặc tab HĐKT.';return;}
  active=a;selection=r.cloneRange();fieldset.disabled=false;
  hint.textContent='Đang sửa đoạn '+(Number(a.dataset.wordIndex)+1)+'. '+(s.isCollapsed?'Bôi đen chữ để định dạng một phần; chưa bôi đen sẽ áp dụng cho cả đoạn.':'Định dạng phần chữ đã bôi đen.');
  for(const button of controls.querySelectorAll('[data-command]'))button.setAttribute('aria-pressed',String(doc.queryCommandState(button.dataset.command)));
 };
 const restore=(whole=false)=>{
  if(!active?.isConnected)throw Error('Bấm vào một đoạn có thể sửa trong bản xem trước.');
  active.focus();const s=doc.getSelection();s.removeAllRanges();
  const range=selection?.cloneRange()||doc.createRange();if(whole||!selection||range.collapsed)range.selectNodeContents(active);s.addRange(range);return s;
 };
 const act=fn=>{try{restore();fn();record(active);capture();}catch(e){onError(e.message);}};
 const group=(label)=>{const g=node('div');g.className='cd-format-group';g.setAttribute('role','group');g.setAttribute('aria-label',label);controls.append(g);return g;};
 const text=group('Kiểu chữ');
 const button=(g,label,fn,command)=>{const b=node('button',label);b.type='button';b.className='btn secondary small';b.title=label;b.setAttribute('aria-label',label);if(command){b.dataset.command=command;b.setAttribute('aria-pressed','false');}b.addEventListener('mousedown',e=>e.preventDefault());b.onclick=()=>act(fn);g.append(b);return b;};
 for(const [label,command]of [['Đậm','bold'],['Nghiêng','italic'],['Gạch chân','underline'],['Gạch ngang','strikeThrough']])button(text,label,()=>doc.execCommand(command,false),command);
 const select=(g,label,options,fn)=>{const l=node('label'),s=node('select');l.append(node('span',label),s);s.setAttribute('aria-label',label);const placeholder=node('option',label);placeholder.value='';s.append(placeholder);for(const [value,name]of options){const o=node('option',name);o.value=value;s.append(o);}s.onchange=()=>{if(s.value)act(()=>fn(s.value));s.value='';};g.append(l);return s;};
 // Explicit CSS on the selected fragment overrides inherited template run fonts too.
 const wrapStyle=(property,value)=>{
  const selection=doc.getSelection(),range=selection.getRangeAt(0),span=doc.createElement('span');
  const start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement,style=doc.defaultView.getComputedStyle(start);
  // docx-preview applies font defaults to every span; carry these before wrapping a new property.
  for(const key of ['fontFamily','fontSize','color'])span.style[key]=style[key];span.style[property]=value;span.append(range.extractContents());
  for(const child of span.querySelectorAll('*'))child.style[property]=value;
  range.insertNode(span);range.selectNodeContents(span);selection.removeAllRanges();selection.addRange(range);
 };
 select(text,'Phông chữ',FONTS.map(f=>[f,f]),f=>wrapStyle('fontFamily',f));
 select(text,'Cỡ chữ',[8,9,10,11,12,13,14,16,18,20,24,28,32,36].map(n=>[String(n),n+' pt']),size=>wrapStyle('fontSize',size+'pt'));
 const colors=group('Màu chữ');
 select(colors,'Màu chữ',[['000000','Đen'],['B91C1C','Đỏ'],['1D4ED8','Xanh dương'],['15803D','Xanh lá'],['7E22CE','Tím'],['6B7280','Xám']],color=>wrapStyle('color','#'+color));
 button(colors,'Bỏ định dạng chữ',()=>doc.execCommand('removeFormat',false));
 const paragraph=group('Định dạng đoạn');
 const paragraphStyle=(key,value,css,style)=>{active.dataset[key]=String(value);if(css)active.style[css]=style;};
 select(paragraph,'Căn lề',[['left','Căn trái'],['center','Căn giữa'],['right','Căn phải'],['both','Căn đều']],value=>paragraphStyle('align',value,'textAlign',value==='both'?'justify':value));
 select(paragraph,'Giãn dòng',[['1','1 dòng'],['1.15','1,15 dòng'],['1.5','1,5 dòng'],['2','2 dòng']],value=>paragraphStyle('lineSpacing',value,'lineHeight',value));
 select(paragraph,'Thụt lề',[['0','Không thụt'],['360','0,63 cm'],['720','1,27 cm'],['1080','1,90 cm'],['1440','2,54 cm']],value=>paragraphStyle('indent',value,'marginLeft',Number(value)/20+'pt'));
 select(paragraph,'Danh sách',[['none','Bỏ danh sách'],['bullet','Dấu đầu dòng'],['decimal','Đánh số']],value=>{
  paragraphStyle('list',value);active.classList.toggle('cd-list-bullet',value==='bullet');active.classList.toggle('cd-list-decimal',value==='decimal');
 });
 const paste=e=>{if(!e.target.closest('[data-word-index]'))return;e.preventDefault();const lines=(e.clipboardData?.getData('text/plain')||'').replace(/\r/g,'').split('\n');for(const [i,line]of lines.entries()){if(i)doc.execCommand('insertLineBreak',false);if(line)doc.execCommand('insertText',false,line);}};
 const drop=e=>{if(e.target.closest('[data-word-index]'))e.preventDefault();};
 doc.addEventListener('selectionchange',capture);doc.addEventListener('paste',paste);doc.addEventListener('drop',drop);
 return ()=>{doc.removeEventListener('selectionchange',capture);doc.removeEventListener('paste',paste);doc.removeEventListener('drop',drop);host.replaceChildren();};
}
