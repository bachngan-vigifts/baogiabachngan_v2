/** Additional initial profile fields. Customer IDs/source synchronization are managed by the server. */
export function customerCreateProfile({api,mainContact,document:doc=document}) {
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text)node.textContent=text;return node;};
  const root=make('div');root.className='customer-create-profile';
  const status=make('p');status.className='muted small';status.setAttribute('role','status');
  const staff=make('fieldset'),staffTitle=make('legend','Phụ trách và chia sẻ');
  const ownerLabel=make('label','Nhân viên phụ trách'),owner=make('select');owner.setAttribute('aria-label','Nhân viên phụ trách');ownerLabel.append(owner);
  const peopleHint=make('p','Chia sẻ cho nhân viên: được xem báo giá, đơn hàng, HĐKT và công nợ của khách.');peopleHint.className='muted small';
  const people=make('div');people.className='customer-share-choices';
  const notice=make('p'),retry=make('button','Tải lại danh sách nhân viên');retry.type='button';retry.className='btn secondary small';retry.hidden=true;
  staff.append(staffTitle,ownerLabel,peopleHint,people,notice,retry);
  const notesLabel=make('label','Ghi chú khách hàng'),notes=make('textarea');notes.rows=4;notes.maxLength=5000;notes.setAttribute('aria-label','Ghi chú khách hàng');notesLabel.append(notes);
  const debtLabel=make('label','Ghi chú công nợ cũ (chỉ Manager, người phụ trách và người được chia sẻ xem được)'),debtNote=make('textarea');debtNote.rows=3;debtNote.maxLength=2000;debtNote.setAttribute('aria-label','Ghi chú công nợ cũ');debtLabel.append(debtNote);
  const directory=make('fieldset'),legend=make('legend','Danh sách người liên hệ'),hint=make('p','Thêm đầy đủ tên, chức vụ, điện thoại, email và ghi chú của từng người. Chọn một liên hệ chính để dùng trên báo giá và đơn hàng. Thông tin liên hệ cũ tự được đưa vào danh sách này.');hint.className='muted small';
  const rowsRoot=make('div'),add=make('button','＋ Thêm người liên hệ');add.type='button';add.className='btn secondary small';
  directory.className='customer-contact-directory span-2';directory.append(legend,hint,rowsRoot,add);root.append(status,staff,notesLabel,debtLabel);
  let rows=[],user=null,seq=0,isNewProfile=true,directoryVersion;
  const option=(value,text)=>{const o=make('option',text);o.value=value;return o;};
  const fillStaff=async()=>{
    const request=++seq;retry.hidden=true;notice.textContent='Đang tải nhân viên…';owner.disabled=true;
    try{
      const d=await api('/tasks/people');if(request!==seq)return;
      const members=d.people.filter(p=>p.role==='employee'||p.role==='manager'),selected=owner.value||user.id;
      owner.replaceChildren(option('','Chưa phân công'),...members.map(p=>option(p.id,p.name)));
      owner.value=members.some(p=>p.id===selected)?selected:user.id;owner.disabled=user.role!=='manager';
      people.replaceChildren(...members.map(p=>{const label=make('label'),check=make('input');check.type='checkbox';check.value=p.id;check.setAttribute('aria-label','Chia sẻ cho '+p.name);label.append(check,make('span',p.name));return label;}));
      notice.textContent=user.role==='manager'?'':'Người tạo là người phụ trách. Chỉ Manager được đổi người phụ trách.';
    }catch{if(request!==seq)return;notice.textContent='Chưa tải được nhân viên. Vẫn có thể lưu với người tạo phụ trách; thử tải lại để chia sẻ.';retry.hidden=false;}
  };
  const syncPrimary=()=>{const primary=rows.find(row=>row.primary.checked)??rows[0];if(primary)primary.primary.checked=true;mainContact.value=primary?.controls.name.value.trim()??'';};
  const addContact=(data={},focus=true)=>{
    if(focus&&rows.length>=50)return;
    const box=make('div');box.className='customer-contact-entry';const controls={};
    for(const [key,label,type,max] of [['name','Tên người liên hệ *','text',500],['title','Chức vụ','text',120],['phone','Điện thoại liên hệ','tel',40],['email','Email liên hệ','email',500],['note','Ghi chú liên hệ','textarea',1000]]){
      const wrap=make('label',label),input=make(type==='textarea'?'textarea':'input');
      if(type!=='textarea')input.type=type;else input.rows=2;
      input.maxLength=max;input.required=key==='name';input.setAttribute('aria-required',String(key==='name'));input.setAttribute('aria-label',label.replace(' *',''));
      input.value=data[key]??'';if(key==='note')wrap.className='span-2';wrap.append(input);box.append(wrap);controls[key]=input;
    }
    const primaryLabel=make('label'),primary=make('input');primary.type='checkbox';primaryLabel.className='customer-primary-choice';primaryLabel.append(primary,make('span','Liên hệ chính'));
    const repLabel=make('label'),representative=make('input');representative.type='checkbox';repLabel.className='customer-primary-choice';repLabel.append(representative,make('span','Người đại diện'));
    const remove=make('button','Bỏ người liên hệ này');remove.type='button';remove.className='btn ghost small';
    primary.checked=data.isPrimary===true||rows.length===0;representative.checked=data.isRepresentative===true;const row={id:data.id??null,box,controls,primary,representative};if(data.isPrimary===true)for(const other of rows)other.primary.checked=false;rows.push(row);representative.addEventListener('change',()=>{if(representative.checked)for(const other of rows)if(other!==row)other.representative.checked=false;});primary.addEventListener('change',()=>{if(primary.checked)for(const other of rows)if(other!==row)other.primary.checked=false;syncPrimary();});
    controls.name.addEventListener('input',()=>{if(primary.checked)syncPrimary();});
    remove.addEventListener('click',()=>{rows=rows.filter(r=>r!==row);box.remove();add.disabled=rows.length>=50;syncPrimary();});box.append(primaryLabel,repLabel,remove);rowsRoot.append(box);add.disabled=rows.length>=50;syncPrimary();if(focus)controls.name.focus();
  };
  add.addEventListener('click',()=>addContact());retry.addEventListener('click',fillStaff);
  return {root,directory,
    reset(current,isNew,existingContacts=[],version){++seq;user=current;isNewProfile=isNew;directoryVersion=version;root.hidden=!isNew;rows=[];rowsRoot.replaceChildren();people.replaceChildren();notes.value='';debtNote.value='';add.disabled=false;
      owner.replaceChildren(option(current.id,current.name));owner.value=current.id;owner.disabled=current.role!=='manager';
      status.textContent=current.role==='manager'?'Trạng thái khi lưu: Đã duyệt. Ngày tạo và nguồn Web được ghi tự động.':'Trạng thái khi lưu: Chờ Manager duyệt. Ngày tạo và nguồn Web được ghi tự động.';
      for(const contact of existingContacts)addContact(contact,false);
      if(isNew&&!existingContacts.length)addContact({},false);syncPrimary();
      if(isNew)fillStaff();
    },
    read(){
      const contacts=rows.map(row=>({...(!isNewProfile?{id:row.id}:{}),...Object.fromEntries(Object.entries(row.controls).map(([key,control])=>[key,control.value.trim()])),isPrimary:row.primary.checked,isRepresentative:row.representative.checked}));
      if(contacts.length>50)throw new Error('Mỗi khách tối đa 50 người liên hệ. Vui lòng gộp hoặc bỏ dòng trùng trước khi lưu.');
      if(contacts.some(c=>!c.name)||isNewProfile&&!contacts.length){(rows.find(r=>!r.controls.name.value.trim())?.controls.name??add).focus();throw new Error('Nhập tên người liên hệ trong danh sách.');}
      syncPrimary();
      if(!isNewProfile)return {contacts,contact:mainContact.value,contactDirectoryVersion:directoryVersion};
      return {notes:notes.value.trim(),legacyDebtNote:debtNote.value.trim(),contacts,sharedIds:[...people.querySelectorAll('input:checked')].map(c=>c.value),...(user.role==='manager'?{ownerId:owner.value||null}:{})};
    },
  };
}
