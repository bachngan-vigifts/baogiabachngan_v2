<?php
/**
 * Plugin Name: LNL Shipping Information
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;

function lnl_si_config() {
    $token = defined('LNL_GHN_TOKEN') ? (string) LNL_GHN_TOKEN : (string) getenv('LNL_GHN_TOKEN');
    $shop = defined('LNL_GHN_SHOP_ID') ? (int) LNL_GHN_SHOP_ID : (int) getenv('LNL_GHN_SHOP_ID');
    return array($token, $shop);
}
function lnl_si_api($path, $payload = null) {
    list($token, $shop) = lnl_si_config();
    if (!$token || !$shop) { return new WP_Error('unavailable', 'Chưa có kết nối GHN.'); }
    $args = array('timeout'=>10, 'headers'=>array('Token'=>$token,'ShopId'=>(string)$shop,'Content-Type'=>'application/json'));
    if (null !== $payload) { $args['method']='POST'; $args['body']=wp_json_encode($payload); }
    $res = wp_remote_request('https://online-gateway.ghn.vn/shiip/public-api'.$path, $args);
    if (is_wp_error($res)) { return new WP_Error('unavailable','Chưa nhận được dự kiến từ GHN.'); }
    $j=json_decode(wp_remote_retrieve_body($res),true);
    if (200 !== wp_remote_retrieve_response_code($res) || 200 !== (int)($j['code']??0)) { return new WP_Error('unavailable','Chưa nhận được dự kiến từ GHN.'); }
    return $j['data']??array();
}
add_filter('rest_post_dispatch',function($response,$server,$request){
    if(strpos($request->get_route(),'/lnl-shipping/v1/')===0 && $response instanceof WP_REST_Response){$response->header('Cache-Control','private, no-store, max-age=0');}
    return $response;
},10,3);
function lnl_si_today() { return wp_date('Y-m-d',time(),new DateTimeZone('Asia/Ho_Chi_Minh')); }
function lnl_si_key($district,$ward,$type) {
    list($token,$shop)=lnl_si_config();
    return 'lnl_si_'.md5($shop.'|'.$district.'|'.$ward.'|'.$type.'|'.substr(hash('sha256',$token),0,12));
}
function lnl_si_estimate($district,$ward,$type=2,$force=false) {
    $key=lnl_si_key($district,$ward,$type);
    $cached=get_transient($key);
    if (!$force && is_array($cached) && ($cached['day']??'')===lnl_si_today()) { return $cached; }
    if (get_transient($key.'_lock')) { return new WP_Error('busy','Đang cập nhật dự kiến giao hàng.'); }
    set_transient($key.'_lock',1,20);
    $r=lnl_si_api('/v2/shipping-order/leadtime',array('to_district_id'=>(int)$district,'to_ward_code'=>(string)$ward,'service_type_id'=>(int)$type));
    delete_transient($key.'_lock');
    if (is_wp_error($r)) { return $r; }
    $from=strtotime($r['leadtime_order']['from_estimate_date']??'');
    $to=strtotime($r['leadtime_order']['to_estimate_date']??'');
    if (!$to) { $to=(int)($r['leadtime']??0); }
    if (!$from) { $from=$to; }
    if ($to<time() || $from>$to) { return new WP_Error('invalid','GHN chưa trả thời gian hợp lệ.'); }
    $result=array('day'=>lnl_si_today(),'from'=>$from,'to'=>$to,'updated'=>time());
    set_transient($key,$result,2*DAY_IN_SECONDS);
    $routes=get_option('lnl_si_routes',array());
    $routes[$key]=array('district'=>(int)$district,'ward'=>(string)$ward,'type'=>(int)$type,'used'=>$force?($routes[$key]['used']??time()):time());
    if(count($routes)>500){uasort($routes,function($a,$b){return $b['used']<=>$a['used'];});$routes=array_slice($routes,0,500,true);}
    update_option('lnl_si_routes',$routes,false);
    return $result;
}

function lnl_si_seed_regions() {
    $specs=array(array('label'=>'Miền Nam · TP.HCM','district'=>1442),array('label'=>'Miền Trung · Đà Nẵng','district'=>1526),array('label'=>'Miền Bắc · Hà Nội','district'=>1489));
    $out=array();
    foreach($specs as $spec){
        $wards=lnl_si_api('/master-data/ward',array('district_id'=>$spec['district']));
        if(is_wp_error($wards)||empty($wards))continue;
        foreach($wards as $ward){
            if(isset($ward['SupportType']) && (int)$ward['SupportType']===3)continue;
            $code=(string)($ward['WardCode']??'');if(!$code)continue;
            $estimate=lnl_si_estimate($spec['district'],$code);
            if(!is_wp_error($estimate)){$spec['ward']=$code;$out[]=$spec;break;}
            break;
        }
    }
    if($out)update_option('lnl_si_regions',$out,false);
    return count($out);
}
function lnl_si_regions() {
    $out=array();$tz=new DateTimeZone('Asia/Ho_Chi_Minh');
    foreach(get_option('lnl_si_regions',array()) as $r){
        $cached=get_transient(lnl_si_key($r['district'],$r['ward'],2));
        if(!is_array($cached)||($cached['day']??'')!==lnl_si_today())continue;
        $out[]=array('label'=>$r['label'],'from'=>wp_date('d/m',$cached['from'],$tz),'to'=>wp_date('d/m',$cached['to'],$tz));
    }
    return $out;
}
add_action('rest_api_init',function(){
    register_rest_route('lnl-shipping/v1','/seed-regions',array('methods'=>'POST','permission_callback'=>'lnl_si_permission','callback'=>function(){return array('regions'=>lnl_si_seed_regions());}));
    register_rest_route('lnl-shipping/v1','/regions',array('methods'=>'GET','permission_callback'=>'__return_true','callback'=>'lnl_si_regions'));
});

function lnl_si_permission($r) {
    return hash_equals('__LNL_SHIPPING_PROBE__',(string)$r->get_header('X-LNL-Shipping'));
}
add_action('rest_api_init',function(){
    register_rest_route('lnl-shipping/v1','/inspect',array('methods'=>'GET','permission_callback'=>'lnl_si_permission','callback'=>function(){
        list($token,$shop)=lnl_si_config();
        do_action('litespeed_purge_url',home_url('/'));
        $out=array('configured'=>(bool)($token&&$shop),'policy'=>get_option('lnl_si_policy_status','pending'));
        global $wpdb;
        $out['next_refresh_local']=wp_date('Y-m-d H:i:s',wp_next_scheduled('lnl_si_midnight'),new DateTimeZone('Asia/Ho_Chi_Minh'));
        $out['cache_plugins']=array_values(array_filter(get_option('active_plugins',array()),function($p){return preg_match('/cloudflare|litespeed|cache/i',$p);}));
        $cf=get_option('litespeed.conf',array());$out['cache_config_keys']=is_array($cf)?array_values(array_filter(array_keys($cf),function($k){return preg_match('/cloudflare|cf[_-]/i',$k);})):array();
        $out['cloudflare_option_names']=$wpdb->get_col("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE '%cloudflare%' OR option_name LIKE 'litespeed%conf%'");
        if (!$out['configured']) { return $out; }
        $shops=lnl_si_api('/v2/shop/all?offset=0&limit=100');
        if(is_wp_error($shops)){ $out['ghn_available']=false;return $out; }
        foreach(($shops['shops']??array()) as $s){if((int)($s['_id']??0)===$shop){
            $out['origin']=array('district'=>(int)$s['district_id'],'ward'=>(string)$s['ward_code']);
            $districts=lnl_si_api('/master-data/district');
            if(!is_wp_error($districts)){foreach($districts as $d){if((int)$d['DistrictID']===(int)$s['district_id']){$out['origin']['province']=(int)$d['ProvinceID'];break;}}}
            $estimate=lnl_si_estimate((int)$s['district_id'],(string)$s['ward_code']);
            $out['estimate_ok']=!is_wp_error($estimate);
            if(!is_wp_error($estimate)){$out['estimate']=$estimate;}
            break;
        }}
        return $out;
    }));
    register_rest_route('lnl-shipping/v1','/eta',array('methods'=>'POST','permission_callback'=>function($r){return (bool)wp_verify_nonce($r->get_header('X-LNL-Nonce'),'lnl_shipping');},'callback'=>function($r){
        $district=absint($r->get_param('district'));$ward=(string)$r->get_param('ward');$type=(int)$r->get_param('type')===5?5:2;
        if(function_exists('wc_load_cart') && function_exists('WC')){if(!WC()->cart)wc_load_cart();if(WC()->cart){$type=wc_get_weight(WC()->cart->get_cart_contents_weight(),'g')>=20000?5:2;}}
        if(!$district || !preg_match('/^[0-9A-Za-z_-]{1,15}$/D',$ward)){return new WP_Error('invalid','Chọn đủ quận/huyện và phường/xã.',array('status'=>400));}
        $rate='lnl_si_rate_'.hash_hmac('sha256',$_SERVER['REMOTE_ADDR']??'',wp_salt());
        $n=(int)get_transient($rate);if($n>=40){return new WP_Error('limited','Vui lòng thử lại sau.',array('status'=>429));}
        set_transient($rate,$n+1,HOUR_IN_SECONDS);
        $e=lnl_si_estimate($district,$ward,$type);
        if(is_wp_error($e)){return new WP_Error('unavailable','Shop sẽ xác nhận thời gian giao hàng khi tiếp nhận đơn.',array('status'=>503));}
        $tz=new DateTimeZone('Asia/Ho_Chi_Minh');
        return array('from'=>wp_date('d/m/Y',$e['from'],$tz),'to'=>wp_date('d/m/Y',$e['to'],$tz),'updated'=>wp_date('H:i d/m/Y',$e['updated'],$tz));
    }));
    register_rest_route('lnl-shipping/v1','/refresh',array('methods'=>'POST','permission_callback'=>'lnl_si_permission','callback'=>function(){lnl_si_queue_refresh();return array('queued'=>true);}));
});
function lnl_si_queue_refresh() {
    $routes=get_option('lnl_si_routes',array());$i=0;
    foreach($routes as $r){
        if($r['used']<time()-7*DAY_IN_SECONDS)continue;
        $args=array($r['district'],$r['ward'],$r['type']);
        if(!wp_next_scheduled('lnl_si_route_refresh',$args)){wp_schedule_single_event(time()+$i*15,'lnl_si_route_refresh',$args);$i++;}
    }
}
add_action('lnl_si_route_refresh',function($district,$ward,$type){lnl_si_estimate($district,$ward,$type,true);},10,3);
add_action('lnl_si_midnight','lnl_si_queue_refresh');
add_action('init',function(){
    if(!wp_next_scheduled('lnl_si_midnight')){
        $next=new DateTimeImmutable('tomorrow 00:00:00',new DateTimeZone('Asia/Ho_Chi_Minh'));
        wp_schedule_event($next->getTimestamp(),'daily','lnl_si_midnight');
    }
});
function lnl_si_policy_update() {
    if(get_option('lnl_si_policy_status')==='updated')return;
    $p=get_post(5457);
    if(!$p || $p->post_name!=='chinh-sach-van-chuyen')return;
    $old=$p->post_content;
    if(substr_count($old,'200.000đ')!==2){update_option('lnl_si_policy_status','needs_review',false);return;}
    $new=preg_replace('/<li\b[^>]*>Đơn hàng dưới\s*<strong\b[^>]*>200\.000đ<\/strong>: phí vận chuyển\s*<strong\b[^>]*>20\.000đ<\/strong><\/li>/u','<li>Đơn hàng dưới <strong>1.000.000đ</strong>: phí vận chuyển được hiển thị tại bước thanh toán theo địa chỉ nhận hàng.</li>',$old,1,$count);
    if($count!==1){update_option('lnl_si_policy_status','needs_review',false);return;}
    $new=str_replace('200.000đ trở lên','1.000.000đ trở lên',$new);
    if(str_contains($new,'200.000đ'))return;
    add_option('lnl_si_policy_backup_v1',$old,'',false);
    $id=wp_update_post(array('ID'=>5457,'post_content'=>wp_slash($new)),true);
    if(!is_wp_error($id)){update_option('lnl_si_policy_status','updated',false);do_action('litespeed_purge_url',get_permalink(5457));}
}
add_action('init','lnl_si_policy_update',30);
add_action('wp_footer',function(){
    if(!is_front_page() && !(function_exists('is_checkout')&&is_checkout()&&!is_order_received_page()))return;
    $config=array('restNonce'=>wp_create_nonce('wp_rest'),'regions'=>rest_url('lnl-shipping/v1/regions'),'endpoint'=>rest_url('lnl-shipping/v1/eta'),'nonce'=>wp_create_nonce('lnl_shipping'),'checkout'=>(bool)is_checkout(),'type'=>2);
    if(function_exists('WC')&&WC()->cart){$config['type']=wc_get_weight(WC()->cart->get_cart_contents_weight(),'g')>=20000?5:2;}
?>
<style id="lnl-shipping-information">
.lnl-ship-hit{position:absolute!important;bottom:0!important;left:0!important;width:32%!important;height:15%!important;min-height:28px!important;margin:0!important;padding:0!important;opacity:1!important;background:transparent!important;border:0!important;box-shadow:none!important;z-index:6;cursor:help}
.lnl-ship-hit:focus-visible{outline:2px solid #2563eb!important;outline-offset:-2px}
#lnl-ship-tip{position:fixed;z-index:100001;width:290px;max-width:calc(100vw - 24px);padding:12px 14px;background:#fff;color:#253e53;border:1px solid #bdd8ec;border-radius:12px;box-shadow:0 8px 28px #163b602b;font-size:13px;line-height:1.45}
#lnl-ship-tip[hidden],#lnl-shipping-eta[hidden]{display:none!important}
#lnl-ship-tip p{margin:5px 0}#lnl-ship-tip a{color:#145c96;text-decoration:underline}
#lnl-shipping-eta{clear:both;margin:12px 0;padding:12px 14px;background:#f1f8fd;border:1px solid #c7e0f0;border-radius:10px;font-size:14px;line-height:1.5}
#lnl-shipping-eta p{margin:4px 0}#lnl-shipping-eta small{display:block;color:#53677a}
</style>
<script id="lnl-shipping-information-js">
(function(){
'use strict';
const cfg=<?php echo wp_json_encode($config,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT);?>;
function init(){
if(cfg.checkout){
 const form=document.querySelector('form.checkout');if(!form)return;
 const panel=document.createElement('section');panel.id='lnl-shipping-eta';panel.hidden=true;panel.setAttribute('aria-live','polite');
 panel.innerHTML='<strong>Dự kiến nhận hàng</strong><p class="lnl-eta-result"></p><small>Thời gian tham khảo từ GHN; shop cần 0–1 ngày làm việc để xử lý đơn. Thời gian thực tế có thể thay đổi theo thời điểm bàn giao và điều kiện vận chuyển.</small><p>Quý khách cần nhận hàng gấp, vui lòng liên hệ <a href="tel:0939961966">Mr Thái – 0939 961 966</a> để được hỗ trợ giao hỏa tốc.</p><small>Các ưu đãi hiện hành không áp dụng cho đơn giao hỏa tốc.</small>';
 const wrapper=form.querySelector('.woocommerce-billing-fields__field-wrapper');if(!wrapper)return;wrapper.append(panel);
 let timer,controller,version=0,last='',memory=new Map();
 function refresh(){
 const prefix=document.querySelector('#ship-to-different-address-checkbox')?.checked?'shipping':'billing';
 const val=n=>document.getElementById(prefix+'_'+n)?.value?.trim()||'';
 const district=val('ghn_district_id'),ward=val('ghn_ward_code'),address=val('address_1'),province=val('ghn_province_id');
 version++;const seq=version;if(controller)controller.abort();
 if(!district||!ward||!address||!province){panel.hidden=true;last='';return;}
 const destination=form.querySelector(prefix==='shipping'?'.woocommerce-shipping-fields__field-wrapper':'.woocommerce-billing-fields__field-wrapper');
 if(destination&&panel.parentElement!==destination)destination.append(panel);
 const key=district+'|'+ward+'|'+cfg.type;
 panel.hidden=false;
 const output=panel.querySelector('.lnl-eta-result');
 function show(data){output.textContent=data.from===data.to?'Dự kiến: '+data.to:'Dự kiến: '+data.from+' – '+data.to;}
 if(memory.has(key)){show(memory.get(key));last=key;return;}
 last=key;output.textContent='Đang tra dự kiến nhận hàng…';controller=new AbortController();
 fetch(cfg.endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-LNL-Nonce':cfg.nonce,'X-WP-Nonce':cfg.restNonce},body:JSON.stringify({district,ward,type:cfg.type}),signal:controller.signal})
 .then(async r=>{const data=await r.json();if(!r.ok)throw Error();return data;})
 .then(data=>{if(seq!==version)return;memory.set(key,data);show(data);})
 .catch(err=>{if(seq===version&&err.name!=='AbortError')output.textContent='Shop sẽ xác nhận thời gian giao hàng khi tiếp nhận đơn.';});
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(refresh,450);}
 form.addEventListener('input',schedule);form.addEventListener('change',schedule);
 if(window.jQuery)window.jQuery(document.body).on('updated_checkout',function(){memory.clear();schedule();});
 refresh();
}
if(!document.body.classList.contains('home'))return;
const tip=document.createElement('aside');tip.id='lnl-ship-tip';tip.hidden=true;tip.setAttribute('role','tooltip');
tip.innerHTML='<strong>Hỗ trợ vận chuyển</strong><p>Miễn phí vận chuyển cho đơn từ <b>1.000.000đ</b>. Đơn dưới ngưỡng này: xem phí tại bước thanh toán.</p><p>Dự kiến GHN theo tuyến tham khảo:</p><div class="lnl-region-times">Chọn địa chỉ tại thanh toán để xem dự kiến cụ thể.</div><small>Tuyến đại diện từng miền, không áp dụng chung cho mọi tỉnh. Chưa gồm thời gian xử lý đơn.</small><p><a href="/chinh-sach-van-chuyen/">Xem chính sách vận chuyển</a></p>';
document.body.append(tip);let active=null,closeTimer,regionsPromise;
function loadRegions(){
 if(regionsPromise)return;
 regionsPromise=fetch(cfg.regions).then(r=>{if(!r.ok)throw Error();return r.json();}).then(rows=>{
 if(!Array.isArray(rows)||!rows.length)return;
 const el=tip.querySelector('.lnl-region-times');el.replaceChildren();
 rows.forEach(row=>{const p=document.createElement('p');p.textContent=row.label+': '+(row.from===row.to?row.to:row.from+' – '+row.to);el.append(p);});
 }).catch(()=>{});
}

function close(){tip.hidden=true;if(active)active.setAttribute('aria-expanded','false');active=null;}
function show(button){
loadRegions();
clearTimeout(closeTimer);if(active&&active!==button)active.setAttribute('aria-expanded','false');active=button;tip.hidden=false;button.setAttribute('aria-expanded','true');
const r=button.getBoundingClientRect();const w=tip.offsetWidth,h=tip.offsetHeight;
tip.style.left=Math.max(12,Math.min(r.left,innerWidth-w-12))+'px';
tip.style.top=Math.max(12,r.top>h+16?r.top-h-8:Math.min(r.bottom+8,innerHeight-h-12))+'px';
}
document.querySelectorAll('.product-small .box-image').forEach(box=>{
if(box.querySelector('.lnl-ship-hit'))return;
const button=document.createElement('button');button.type='button';button.className='lnl-ship-hit';button.setAttribute('aria-label','Xem chính sách miễn phí vận chuyển');button.setAttribute('aria-describedby',tip.id);button.setAttribute('aria-expanded','false');
box.style.position='relative';box.append(button);
button.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')show(button);});
button.addEventListener('pointerleave',()=>{closeTimer=setTimeout(close,180);});
button.addEventListener('focus',()=>show(button));
button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(active===button&&tip.dataset.clicked==='yes'){close();tip.dataset.clicked='';}else{show(button);tip.dataset.clicked='yes';}});
});
tip.addEventListener('pointerenter',()=>clearTimeout(closeTimer));tip.addEventListener('pointerleave',close);
document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
document.addEventListener('click',e=>{if(!tip.contains(e.target)&&!e.target.closest('.lnl-ship-hit'))close();});
document.addEventListener('focusin',e=>{if(active&&!tip.contains(e.target)&&e.target!==active)close();});
window.addEventListener('scroll',close,{passive:true});window.addEventListener('resize',close);
}
init();
})();
</script>
<?php
},98);
