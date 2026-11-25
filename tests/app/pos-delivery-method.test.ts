import {test} from 'node:test';
import assert from 'node:assert/strict';
import {posDeliveryMethod,manualPosDelivery} from '../../src/modules/sales/domain/pos-delivery-method.ts';
test('manual delivery validates names and rejects GHN fields instead of routing a manual order to GHN',()=>{
 assert.equal(posDeliveryMethod({}).method,'ghn');
 assert.equal(posDeliveryMethod({deliveryMethod:'anh_chinh'}).name,'Xe anh Chinh');
 assert.throws(()=>posDeliveryMethod({deliveryMethod:'chanh_xe'}));
 assert.throws(()=>posDeliveryMethod({deliveryMethod:'unknown'}));
 assert.throws(()=>posDeliveryMethod({deliveryMethod:'nhat_tin',ghnOrderCode:'GHN-001'}));
 assert.equal(manualPosDelivery(JSON.stringify({deliveryMethod:{method:'nhat_tin'}})),true);
 assert.equal(manualPosDelivery('{}'),false);
});
