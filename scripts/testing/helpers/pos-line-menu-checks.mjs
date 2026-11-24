import assert from 'node:assert/strict';

export async function checkLineMenu(page, screenshot) {
  const search=page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'});
  await search.fill('00456');await page.locator('.pos-product[data-sku="00456"]').waitFor();await search.press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.pos-line').length===2);
  const row=page.locator('.pos-line').first(), trigger=row.getByRole('button',{name:/^Thao tác dòng /});
  assert.equal(await trigger.count(),1,'line actions have a keyboard accessible button');
  const size=await trigger.boundingBox();
  assert.ok(size.width>=32&&size.height>=32,'ellipsis has a usable hit target');
  await trigger.click();
  const panel=row.locator('.pos-ref-line-popover');
  await panel.waitFor({state:'visible'});
  await page.waitForFunction(()=>{const p=document.querySelector('.pos-ref-line-popover:popover-open');return p&&parseFloat(p.style.left)>0&&parseFloat(p.style.top)>0;});
  assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  const box=await panel.boundingBox(),viewport=page.viewportSize();
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,'menu fits the viewport');
  assert.ok(Math.abs(box.x+box.width-size.x-size.width)<2,'menu aligns with its own ellipsis');
  assert.equal(await panel.evaluate(n=>document.elementFromPoint(n.getBoundingClientRect().x+10,n.getBoundingClientRect().y+10)===n||n.contains(document.elementFromPoint(n.getBoundingClientRect().x+10,n.getBoundingClientRect().y+10))),true,'scroll container cannot clip menu');
  await page.screenshot({path:screenshot});
  await page.keyboard.press('Escape');
  await panel.waitFor({state:'hidden'});
  await trigger.focus();await page.keyboard.press('Enter');
  await panel.getByRole('button',{name:'Chiết khấu',exact:true}).click();
  assert.equal(await row.locator('.pos-line-discount input').evaluate(n=>n===document.activeElement),true,'discount action focuses the existing input');
  assert.equal(await row.locator('.pos-line-discount input').inputValue(),'','zero discount starts empty');
  await trigger.click();await panel.getByRole('button',{name:'Ghi chú',exact:true}).click();
  const note=row.locator('.pos-line-note');await note.fill('Gói riêng <b>từng chén</b>');
  assert.equal(await note.evaluate(n=>n===document.activeElement),true);
  assert.equal(await row.locator('.pos-line-name b').count(),0,'note is plain text');
  const aligned=await note.evaluate(n=>{const q=n.closest('.pos-line').querySelector('.pos-qty').getBoundingClientRect(),r=n.getBoundingClientRect();return Math.abs(r.y-q.y)<8;});
  assert.equal(aligned,true,'note aligns with quantity in scan mode');
  assert.ok((await note.boundingBox()).width>150,'note uses available product-name width');
  await page.screenshot({path:screenshot.replace('.png','-note.png')});
  await page.reload();await page.waitForFunction(()=>window.ready===true);
  await note.waitFor({state:'visible'});
  assert.equal(await note.inputValue(),'Gói riêng <b>từng chén</b>','reload restores product note');
  assert.equal(await row.locator('.pos-line-discount input').inputValue(),'','reload preserves blank zero discount');
  await trigger.click();await page.mouse.click(5,page.viewportSize().height-5);
  await panel.waitFor({state:'hidden'});
  await trigger.click();
  const second=page.locator('.pos-line').nth(1),secondTrigger=second.getByRole('button',{name:/^Thao tác dòng /});
  // The first popover may cover the next row's trigger; keyboard activation
  // tests switching menus without clicking through that intentional overlay.
  await secondTrigger.focus();await secondTrigger.press('Enter');await panel.waitFor({state:'hidden'});
  assert.equal(await page.locator('.pos-ref-line-popover:popover-open').count(),1,'only one line menu is open');
  await second.locator('.pos-ref-line-popover').getByRole('button',{name:'Xóa dòng sản phẩm',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.pos-line').length===1);
  // Place the trigger near a viewport corner to exercise the upward fallback.
  const current=page.locator('.pos-line').first().getByRole('button',{name:/^Thao tác dòng /});
  await current.evaluate(n=>{n.parentElement.style.cssText='position:fixed;right:8px;bottom:8px;z-index:50';});
  await current.click();
  const corner=page.locator('.pos-ref-line-popover:popover-open');
  await page.waitForFunction(()=>parseFloat(document.querySelector('.pos-ref-line-popover:popover-open')?.style.top)>0);
  const cornerBox=await corner.boundingBox(),anchor=await current.boundingBox();
  assert.ok(cornerBox.y+cornerBox.height<anchor.y,'menu flips above a bottom-edge trigger');
  await page.keyboard.press('Escape');
  await current.evaluate(n=>n.parentElement.removeAttribute('style'));
  // A failed read must keep the cart intact and leave the action retryable.
  const failure='**/api/pos/catalog?*skus=00123';
  await page.route(failure,r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Lỗi đọc tồn kiểm thử'})}),{times:1});
  await current.click();await row.locator('.pos-ref-line-popover').getByRole('button',{name:'Xem chi tiết / tồn kho',exact:true}).click();
  await page.waitForFunction(()=>window.notices.includes('Lỗi đọc tồn kiểm thử'));
  assert.equal(await row.locator('.pos-qty input').inputValue(),'4','read failure preserves quantity');
  await current.click();
  await row.locator('.pos-ref-line-popover').getByRole('button',{name:'Xem chi tiết / tồn kho',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:/Tồn kho/});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Đóng',exact:true}).last().click();
  assert.equal(await panel.isVisible(),false,'choosing an action closes its menu');
}
