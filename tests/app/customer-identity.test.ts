import {test} from 'node:test';import assert from 'node:assert/strict';
import {customerNameKey,customerPhoneKeys,changedIdentity,customerIdentityIndex} from '../../src/modules/customers/domain/identity.ts';
test('customer identity normalization: Vietnamese text, formatting, multiple phones, empty fields and tax branches',()=>{
  assert.equal(customerNameKey('  FPT - NHẬT  PHƯƠNG '),'fpt nhat phuong');
  assert.deepEqual(customerPhoneKeys('(+84) 868 908 378; 0084868908378 / 0901.222.333'),['0868908378','0901222333']);
  assert.deepEqual(customerPhoneKeys(' -- ; 0000000000'),[]);
  assert.deepEqual(changedIdentity({name:'NHẬT PHƯƠNG',phone:'+84868908378',taxCode:'01.234'},{name:'Nhat-Phuong',phone:'0868908378',taxCode:'01234'}),{});
  const index=customerIdentityIndex([{id:'a',name:'FPT Nhật Phương',phone:'0868908378 / 0901222333',taxCode:'01234-001'}]);
  assert.deepEqual(index.find({phone:'0901 222 333'})[0]!.reasons,['phone']);
  assert.equal(index.find({taxCode:'01234'}).length,0,'branch tax code is distinct');
  assert.equal(index.find({name:'FPT NHAT PHUONG'},'a').length,0,'exclude current customer');
  assert.equal(index.find({name:'',phone:'',taxCode:''}).length,0);
  const emptyTax=customerIdentityIndex([{id:'z',name:'Khách A',taxCode:'0000000000'}]);
  assert.equal(emptyTax.find({name:'Khách B',taxCode:'0000000000'}).length,0,'all-zero placeholder tax is not an identity');
  index.put({id:'a',name:'Đổi tên',phone:'0977111111'});
  assert.equal(index.find({phone:'0868908378'}).length,0,'updates remove stale keys');
  assert.equal(index.find({name:'Doi ten'}).length,1);
});
