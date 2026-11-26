import assert from 'node:assert/strict';
export async function checkHeaderMenu(page, screenshot){
 const menu=page.locator('.pos-ref-menu,.pos-mobile-menu').first();await menu.locator(':scope > summary').click();
 const body=menu.locator('.pos-ref-menu-body,.pos-mobile-menu-body'),more=body.locator('.pos-more-menu');
 await more.locator('summary').click();
 const panel=more.locator('.pos-more-panel');
 await panel.getByRole('button',{name:'Chọn bảng giá',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:screenshot});
 assert.equal(await body.evaluate(n=>{const r=n.getBoundingClientRect();for(let y=r.top+16;y<r.bottom-8;y+=32){for(const x of [r.left+16,r.left+r.width/2,r.right-16]){const hit=document.elementFromPoint(x,y);if(hit!==n&&!n.contains(hit))return false;}}return true;}),true,'header search and invoice tabs cannot cover the open menu');
 const bounds=await panel.evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.pos-ref-menu-body,.pos-mobile-menu-body').getBoundingClientRect();return {left:r.left,right:r.right,parentLeft:p.left,parentRight:p.right,width:n.scrollWidth,client:n.clientWidth};});
 assert.ok(bounds.left>=bounds.parentLeft&&bounds.right<=bounds.parentRight,'nested actions must fit inside the scrolling menu');
 assert.ok(bounds.width<=bounds.client+1,'nested actions must not overflow horizontally');
 const button=panel.getByRole('button',{name:'Chọn bảng giá',exact:true});
 assert.equal(await button.evaluate(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return n===hit||n.contains(hit);}),true,'action is not clipped or covered');
 await button.click();await page.getByRole('dialog').last().waitFor();await page.getByRole('dialog').last().getByRole('button',{name:'Đóng',exact:true}).last().click();
 await menu.locator(':scope > summary').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
}
