import {initAmbient} from './breathing-ambient.js';
const ambient=initAmbient({root:document.querySelector('#ambient-panel')});
import {initBreathing} from './breathing-wim.js';
import {initGentle} from './breathing-gentle.js';
const gentleRoot=document.querySelector('#gentle-panel'),wimRoot=document.querySelector('#wim-panel');
const gentle=initGentle({root:gentleRoot,onStop:ambient.stop});let wim=null,selected='gentle';
const buttons=[...document.querySelectorAll('[data-mode]')];
buttons.forEach(button=>button.addEventListener('click',()=>{const next=button.dataset.mode;if(next===selected)return;ambient.stop();if(selected==='gentle')gentle.close();else wim?.close();selected=next;if(next==='wim'&&!wim){wim=initBreathing({root:wimRoot,onStop:ambient.stop});wim.show();}gentleRoot.hidden=next!=='gentle';wimRoot.hidden=next!=='wim';buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===next)));document.querySelector('#mode-description').textContent=next==='gentle'?'Thở nhẹ, không giữ hơi.':'Wim Hof có giữ hơi tùy sức. Đọc hướng dẫn trước khi tập.';}));
