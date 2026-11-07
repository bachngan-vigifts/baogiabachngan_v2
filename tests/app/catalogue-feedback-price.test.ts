import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupWarehouseWork} from '../helpers/warehouse-work-fixture.ts';
import {catalogueLibrary,catalogueQuotes} from '../../src/modules/catalog/catalogue-library-schema.ts';

test('nhập lại giá Liên hệ báo chênh lệch, không ghi đè; xác nhận sửa thư viện không sửa báo giá cũ',async()=>{
 const f=await setupWarehouseWork(),product={name:'Bộ trà kiểm thử',brand:'Bát Tràng',category:'Bộ trà',sku:'BT-PRICE',url:'https://example.com/products/tea',regular:546000,priceOnRequest:false};
 const create=await f.call('/catalogue-library',f.cookies.emp,'POST',{products:[{clientId:'old',product}]});assert.equal(create.status,200);
 const original=create.data.products[0],quote=JSON.stringify({products:[original.product]});
 await f.db.insert(catalogueQuotes).values({id:'snapshot-test',quoteNo:'TEST-QUOTE',title:'Kiểm thử',customer:'',productCount:1,search:'',data:quote,createdBy:'emp',updatedBy:'emp',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 const reread=await f.call('/catalogue-library/'+original.id,f.cookies.emp);assert.equal(reread.status,200);assert.equal(reread.data.revision,1);assert.equal(reread.data.product.regular,546000);
 assert.equal((await f.call('/catalogue-library/'+original.id)).status,401);assert.equal((await f.call('/catalogue-library/'+original.id,f.cookies.ncc)).status,403);
 const imported={...product,regular:0,priceOnRequest:true};
 const again=await f.call('/catalogue-library',f.cookies.emp,'POST',{products:[{clientId:'new',product:imported}]});assert.equal(again.status,200);
 const row=again.data.products[0];assert.equal(row.id,original.id);assert.equal(row.product.regular,546000);assert.equal(row.product.priceOnRequest,false);
 assert.deepEqual(row.priceConflict.incoming,{regular:0,priceOnRequest:true,fromPrice:false});
 const update=await f.call('/catalogue-library/'+row.id,f.cookies.emp,'PUT',{revision:row.revision,clientKey:crypto.randomUUID(),product:{...row.product,...row.priceConflict.incoming}});assert.equal(update.status,200,JSON.stringify(update.data));
 assert.equal(update.data.product.regular,0);assert.equal(update.data.product.priceOnRequest,true);
 const [savedQuote]=await f.db.select().from(catalogueQuotes).where(eq(catalogueQuotes.id,'snapshot-test'));assert.equal(savedQuote!.data,quote);
 const noConflict=await f.call('/catalogue-library',f.cookies.emp,'POST',{products:[{clientId:'same',product:imported}]});assert.equal(noConflict.data.products[0].priceConflict,undefined);
 const [stored]=await f.db.select().from(catalogueLibrary).where(eq(catalogueLibrary.id,row.id));assert.equal(stored!.revision,2);
});
