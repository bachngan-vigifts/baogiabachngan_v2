import assert from 'node:assert/strict';
export async function auditDialog(page,selector,name,width,out,{close=true}={}){
 const d=page.locator(selector);await d.waitFor({state:'visible'});
 await page.waitForTimeout(80);
 const metrics=await d.evaluate(n=>{
  const b=n.getBoundingClientRect(),body=n.querySelector('.landscape-dialog-body'),head=n.querySelector('.landscape-dialog-head'),foot=n.querySelector('.landscape-dialog-foot');
  const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const buttons=[...n.querySelectorAll('.landscape-dialog-foot button')].filter(e=>e.getBoundingClientRect().width>0).map(rect);
  const heading=head?.querySelector('h2'),close=head?.querySelector('button');
  return{box:rect(n),body:body&&rect(body),head:head&&rect(head),heading:heading&&rect(heading),close:close&&rect(close),foot:foot&&rect(foot),buttons,wide:n.classList.contains('landscape-dialog'),overflow:n.scrollWidth>n.clientWidth+2,ratio:b.width/b.height};
 });
 assert.ok(!metrics.overflow,name+' horizontal overflow');
 assert.ok(metrics.box.x>=-1&&metrics.box.right<=width+1,name+' outside viewport');
 if(metrics.heading&&metrics.close){const a=metrics.heading,b=metrics.close;assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,name+' title overlaps close button');}
 if(width>=900){assert.ok(metrics.wide,name+' should be landscape');assert.ok(Math.abs(metrics.ratio-16/9)<0.03,name+' ratio '+metrics.ratio);
 assert.ok(metrics.body.bottom<=metrics.foot.y+2,name+' body overlaps footer');
 if(metrics.head)assert.ok(metrics.head.bottom<=metrics.body.y+2,name+' head overlaps body');
 for(let a=0;a<metrics.buttons.length;a++)for(let b=a+1;b<metrics.buttons.length;b++){const x=metrics.buttons[a],y=metrics.buttons[b];assert.ok(x.right<=y.x+1||y.right<=x.x+1||x.bottom<=y.y+1||y.bottom<=x.y+1,name+' overlapping buttons');}
 await page.screenshot({path:`${out}/${name}-${width}-top.png`});
 await d.locator('.landscape-dialog-body').evaluate(n=>n.scrollTop=n.scrollHeight);
 assert.ok(await d.locator('.landscape-dialog-foot button:enabled').evaluateAll(buttons=>buttons.every(b=>{const r=b.getBoundingClientRect();return !r.width||b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})),name+' covered footer button');
 const final=await d.locator('.landscape-dialog-foot').boundingBox();assert.ok(final.y+final.height<= (await page.viewportSize()).height+1,name+' footer off screen');
 }
 await page.screenshot({path:`${out}/${name}-${width}.png`});const result={name,width,...metrics};
 if(close){await d.evaluate(n=>n instanceof HTMLDialogElement?n.close():n.hidden=true);await d.waitFor({state:'hidden'});}
 return result;
}
