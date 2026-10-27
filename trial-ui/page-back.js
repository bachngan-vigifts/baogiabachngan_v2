const internal=hash=>typeof hash==='string'&&/^#\/[a-z][a-z0-9-]*(?:[/?]|$)/i.test(hash);
/** Tag only accepted routes. Browser Back/Forward restore their own predecessor, not a synthetic reverse stack. */
export function createPageBack({button,history,hash,user,home,canVisit,label,go}){
 let current=null;
 const allowed=target=>internal(target)&&canVisit(target);
 function fallback(){const value=hash(),[path,query='']=value.replace(/^#\//,'').split('?'),[page,id]=path.split('/');
  const parent=id?(page==='members'?'#/staff':'#/'+page):page==='products'&&new URLSearchParams(query).has('sku')?'#/products':'';
  return allowed(parent)&&parent!==value?parent:home();
 }
 const target=()=>allowed(current?.previous)&&current.previous!==hash()?current.previous:fallback();
 function render(){const to=target(),text=to&&to!==hash()?label(to):'Trở lại';button.textContent='‹ '+text;button.title='Trở lại '+text;button.setAttribute('aria-label','Trở lại '+text);button.disabled=!allowed(to)||to===hash();}
 function record(){const value=hash(),identity=user(),stored=history.state?.crmPageBack;
  if(stored?.user===identity&&stored.hash===value&&internal(stored.hash)){current=stored;}
  else if(current?.user!==identity||current?.hash!==value){current={user:identity,hash:value,previous:current?.user===identity&&allowed(current.hash)?current.hash:''};}
  if(history.state?.crmPageBack!==current)history.replaceState({...history.state,crmPageBack:current},'');render();
 }
 button.addEventListener('click',()=>{const to=target();if(!allowed(to)||to===hash())return;const stored=history.state?.crmPageBack;
  if(stored?.user===user()&&stored.hash===hash()&&stored.previous===to)history.back();else go(to);
 });
 return{record};
}
