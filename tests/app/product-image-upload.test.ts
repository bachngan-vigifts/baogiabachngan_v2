import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../helpers/pos-fixture.ts';
import {memoryFileStore} from '../../src/core/storage/file-store.ts';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLcUAAAAASUVORK5CYII=';
test('ảnh sản phẩm: upload file vào kho công khai, dùng URL thêm/sửa sản phẩm, chặn file giả và quá lớn',async()=>{
 const f=await setup(),store=memoryFileStore();f.env.productImages=store;
 const uploaded=await f.call('/product-images',f.emp,'POST',{image:png});assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));assert.match(uploaded.data.imageUrl,/^https:\/\/files.test\/public\/uploads\/[^/]+\.png$/);assert.equal(store.files.size,1);
 const [file]=[...store.files.values()];assert.equal(file!.mime,'image/png');assert.equal(file!.bytes[0],137);
 const created=await f.call('/products',f.emp,'POST',{sku:'UPLOAD-NEW',name:'Sản phẩm chờ duyệt có ảnh',imageUrl:uploaded.data.imageUrl});assert.equal(created.status,201);assert.equal(created.data.approvalStatus,'pending');
 const before=(await f.call('/products/00123',f.mgr)).data.product;
 const saved=await f.call('/products/00123',f.mgr,'PUT',{...before,expectedUpdatedAt:before.updatedAt,imageUrl:uploaded.data.imageUrl,prices:{}});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal((await f.call('/products/00123',f.mgr)).data.product.imageUrl,uploaded.data.imageUrl);
 for(const image of ['data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,SGVsbG8=','not-an-image',png.replace('image/png','image/jpeg')])assert.ok([400,415].includes((await f.call('/product-images',f.emp,'POST',{image})).status));
 const large='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(240001)]).toString('base64');assert.equal((await f.call('/product-images',f.mgr,'POST',{image:large})).status,413);assert.equal(store.files.size,1,'rejected files write nothing');
 delete f.env.productImages;assert.equal((await f.call('/product-images',f.mgr,'POST',{image:png})).status,503);
 assert.equal((await f.call('/product-images','','POST',{image:png})).status,401);
});
