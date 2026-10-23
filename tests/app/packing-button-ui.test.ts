import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('nút lên lịch & đóng gói mờ khi đủ phiếu; mở lại khi còn số lượng sau huỷ phiếu',()=>{
  const source=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
  const button={disabled:false,title:''};
  const fn=runInNewContext(source.slice(source.indexOf('function syncOrderPackingButton('),source.indexOf('async function loadOrderPacking('))+';syncOrderPackingButton',{$:()=>button});
  fn({canRequest:true,lines:[{left:0},{left:0}]});assert.equal(button.disabled,true);assert.match(button.title,/đã có đủ phiếu/);
  fn({canRequest:true,lines:[{left:0},{left:20}]});assert.equal(button.disabled,false);
  fn({canRequest:false,lines:[{left:20}]});assert.equal(button.disabled,true);
});
