import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionKind} from '../../trial-ui/mobile-action-policy.js';
import {GROUP_MIN} from '../../trial-ui/mobile-actions.js';

/** Nút giả tối thiểu cho actionKind (chỉ cần chữ, không nằm trong hộp thoại / form). */
const node=(text:string)=>({textContent:text,title:'',getAttribute:()=>null,classList:{contains:()=>false},matches:()=>false,closest:()=>null,querySelector:()=>null}) as unknown as Element;

test('mobile: nút phân trang luôn nằm tại chỗ, không gom vào ⋮',()=>{
 for(const t of ['‹ Trang trước','Trang tiếp ›','‹ Trước','Sau ›','‹','›'])assert.equal(actionKind(node(t)),'inline',t);
 assert.equal(actionKind(node('＋ Thêm sản phẩm')),'inline');
 assert.equal(actionKind(node('Dán từ Excel')),'secondary','thao tác phụ vẫn được gom khi đủ số lượng');
});

test('mobile: chỉ gom vào ⋮ khi có từ 3 thao tác',()=>assert.equal(GROUP_MIN,3));
