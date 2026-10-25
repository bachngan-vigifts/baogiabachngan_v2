<?php
/** In-memory WP/Woo/GHN doubles. No WordPress bootstrap, installer execution or real HTTP. */
define('ABSPATH', __DIR__); define('MINUTE_IN_SECONDS',60); define('DAY_IN_SECONDS',86400);
$input = json_decode(stream_get_contents(STDIN), true); $scenario = $input['scenario'];
define('LNL_GHN_TOKEN', $scenario === 'config-missing' ? '' : 'fake-ghn-private-token');
define('LNL_GHN_SHOP_ID', $scenario === 'config-missing' ? 0 : 731337);
$checks = 0;
function check($ok, $label) { global $checks; $checks++; if (!$ok) { throw new RuntimeException($label); } }
class WP_Error {
    public $code; public $message; public $data;
    function __construct($c,$m,$d=array()) { $this->code=$c; $this->message=$m; $this->data=$d; }
    function get_error_code(){return $this->code;}
    function get_error_message(){return $this->message;}
    function get_error_data(){return $this->data;}
}
function is_wp_error($x){return $x instanceof WP_Error;}
function wp_strip_all_tags($s){return strip_tags($s);}
function sanitize_text_field($s){return trim(strip_tags((string)$s));}
function sanitize_key($s){return preg_replace('/[^a-z0-9_-]/','',strtolower($s));}
function absint($x){return abs((int)$x);}
function esc_html($x){return htmlspecialchars($x,ENT_QUOTES,'UTF-8');}
function wp_json_encode($x){return json_encode($x,JSON_UNESCAPED_UNICODE);}
function get_current_blog_id(){return 1;}
function get_option($name,$default=null){return $default;}
if(!function_exists('mb_substr')){function mb_substr($s,$a,$n){return implode('',array_slice(preg_split('//u',$s,-1,PREG_SPLIT_NO_EMPTY),$a,$n));}}
$hooks=array(); $transients=array();
function add_action($name,$fn,$priority=10,$argc=1){$GLOBALS['hooks'][$name][]=array($fn,$argc);}
function add_filter($name,$fn){add_action($name,$fn);}
function do_action($name,...$args){foreach($GLOBALS['hooks'][$name]??array() as $x){call_user_func_array($x[0],array_slice($args,0,$x[1]));}}
function get_transient($key){return $GLOBALS['transients'][$key]??false;}
function set_transient($key,$v,$ttl){$GLOBALS['transients'][$key]=$v;}
function delete_transient($key){unset($GLOBALS['transients'][$key]);}
function register_rest_route($ns,$path,$args){$GLOBALS['route']=$args['callback'];}
class WP_REST_Request {
    public $params;
    function __construct($p){$this->params=$p;}
    function get_param($k){return $this->params[$k]??null;}
    function get_header($k){return 'Bearer '.$GLOBALS['input']['bridgeToken'];}
}
class FakeProduct {
    function get_sku(){return 'TEST-EXACT-SKU';}
    function get_weight(){return 1.25;}
    function get_length(){return 33;}
    function get_width(){return 21;}
    function get_height(){return 4;}
}
class WC_Order_Item_Product {
    function get_product(){return new FakeProduct();}
    function get_name(){return 'Fixture product';}
    function get_quantity(){return 2;}
}
$db=array('meta'=>array('_lnl_ghn_shipping_province_id'=>'211','_lnl_ghn_shipping_district_id'=>'1929','_lnl_ghn_shipping_ward_code'=>'490707'),
    'status'=>'pending','total'=>1000,'shipping'=>array('address_1'=>'Fixture road','address_2'=>'Fixture ward','city'=>'Fixture district','state'=>'Fixture province'));
class WC_Order {
    public $meta; public $dirty=array(); public $deleted=array(); public $status; public $shipping;
    function __construct(){ $this->meta=$GLOBALS['db']['meta'];$this->status=$GLOBALS['db']['status'];$this->shipping=$GLOBALS['db']['shipping']; }
    function get_id(){return 21496;}
    function get_data_store(){return new FakeOrderStore();}
    function get_order_number(){return $GLOBALS['renumbered']??'21496';}
    function get_status(){return $this->status;}
    function has_status($s){return $this->status===$s;}
    function get_meta($k){return $this->meta[$k]??'';}
    function update_meta_data($k,$v){$this->meta[$k]=$v;$this->dirty[$k]=$v;}
    function delete_meta_data($k){unset($this->meta[$k],$this->dirty[$k]);$this->deleted[]=$k;}
    function read_meta_data($force=false){check($force===true,'force metadata refresh');$this->meta=$GLOBALS['db']['meta'];$this->dirty=array();$this->deleted=array();}
    function save(){
        global $db,$scenario,$phase;
        if($phase===0&&$scenario==='intent-fail'&&isset($this->dirty['_lnl_crm_ghn_create_attempted'])){throw new RuntimeException('simulated DB failure');}
        if($phase===0&&$scenario==='persist-throw'&&isset($this->dirty['_lnl_ghn_order_code'])){throw new RuntimeException('simulated DB failure');}
        foreach($this->dirty as $k=>$v){
            if($phase===0&&$scenario==='persist-drop'&&$k==='_lnl_ghn_order_code'){continue;}
            if($scenario==='intent-drop'&&$k==='_lnl_crm_ghn_create_attempted'){continue;}
            $db['meta'][$k]=$v;
        }
        foreach($this->deleted as $k){unset($db['meta'][$k]);}
        $db['shipping']=$this->shipping;$db['status']=$this->status;
        if($scenario==='order-changed'&&isset($this->dirty['_lnl_crm_ghn_create_attempted'])){$db['total']=1001;}
        $this->dirty=array();$this->deleted=array();return 21496;
    }
    function get_total(){return $GLOBALS['db']['total'];}
    function get_payment_method(){return 'cod';}
    function get_items($type){return array(new WC_Order_Item_Product());}
    function get_line_subtotal($item,$tax,$round){check($tax===false&&$round===false,'unchanged price formula');return 600;}
    function has_shipping_address(){return true;}
    function add_order_note($text){check(strpos($text,'fake-ghn-private-token')===false,'no credential in notes');}
    function update_status($status,$note=''){if($GLOBALS['scenario']==='post-status-fail'&&$GLOBALS['phase']===0){throw new RuntimeException('status DB failure');}$this->status=$status;$this->save();do_action('woocommerce_order_status_'.$status,21496,$this);}
    function __call($name,$args){
        if(strpos($name,'set_shipping_')===0){$this->shipping[substr($name,13)]=$args[0];return;}
        if(strpos($name,'get_shipping_')===0){$k=substr($name,13);return $this->shipping[$k]??array('first_name'=>'Fixture','last_name'=>'Buyer','phone'=>'0900000000')[$k]??'';}
        if(strpos($name,'get_billing_')===0){return '';}
        throw new RuntimeException('Unexpected Woo method');
    }
}
class FakeOrderStore {
    function read($order){$order->meta=$GLOBALS['db']['meta'];$order->status=$GLOBALS['db']['status'];$order->shipping=$GLOBALS['db']['shipping'];}
}
function wc_get_order($id){check((int)$id===21496,'only fake order');if($GLOBALS['scenario']==='persist-unreadable'&&$GLOBALS['phase']===0&&!empty($GLOBALS['carrier'])){throw new RuntimeException('readback unavailable');}return new WC_Order();}
class FakeWpdb {
    public $held=false;
    function prepare($sql,$lock){check($lock==='lnl_crm_ghn_1_21496','same order lock key');return array($sql,$lock);}
    function get_var($query){
        if(strpos($query[0],'GET_LOCK')!==false){if($this->held||$GLOBALS['scenario']==='lock-busy'){return 0;}$this->held=true;return 1;}
        if(strpos($query[0],'IS_USED_LOCK')!==false){return $GLOBALS['scenario']==='lock-lost'?0:($this->held?1:0);}
        check(strpos($query[0],'RELEASE_LOCK')!==false,'only advisory lock SQL');$this->held=false;return 1;
    }
}
$wpdb=new FakeWpdb();$phase=0;$create_count=0;$lookups=0;$carrier=null;$wire=array();$nested=null;
function response($code,$body){return array('response'=>array('code'=>$code),'body'=>json_encode($body));}
function wp_remote_retrieve_body($r){return $r['body'];}
function wp_remote_retrieve_response_code($r){return $r['response']['code'];}
function carrier(){return array('order_code'=>'GHN21496','client_order_code'=>'21496','shop_id'=>731337,'sort_code'=>'FIXTURE-SORT','total_fee'=>22000,'status'=>'ready_to_pick');}
function wp_remote_request($url,$args){
    global $scenario,$phase,$create_count,$lookups,$carrier,$wire,$nested,$db;
    check(strpos($url,'https://online-gateway.ghn.vn/shiip/public-api/')===0,'only fake GHN host');
    check($args['headers']['Token']==='fake-ghn-private-token','runtime token used');
    check($args['headers']['ShopId']==='731337','runtime shop used');
    $path=parse_url($url,PHP_URL_PATH);parse_str(parse_url($url,PHP_URL_QUERY)??'',$query);
    $body=isset($args['body'])?json_decode($args['body'],true):null;
    $wire[]=array('path'=>$path,'method'=>$args['method'],'body'=>$body,'query'=>$query);
    if(strpos($path,'detail-by-client-code')!==false){
        $lookups++;check($args['method']==='GET'&&($query['client_order_code']??'')==='21496','documented GET and stable client code');
        if($scenario==='lookup-unavailable'){return new WP_Error('http_request_failed','untrusted secret');}
        if($scenario==='lookup-ambiguous'){return response(404,array('code'=>404,'message'=>'Not found'));}
        if($scenario==='lookup-permission'){return response(400,array('code'=>400,'message'=>'CLIENT_NOT_OWNER_OF_SHOP'));}
        if($scenario==='lookup-wrong-client'||$scenario==='lookup-wrong-shop'){
            $data=carrier();$data[$scenario==='lookup-wrong-client'?'client_order_code':'shop_id']=$scenario==='lookup-wrong-client'?'OTHER':999;
            return response(200,array('code'=>200,'data'=>$data));
        }
        if($carrier&& !($scenario==='timeout-late'&&$phase===0)){return response(200,array('code'=>200,'data'=>$carrier));}
        return response(400,array('code'=>400,'message'=>'Đơn hàng không tồn tại','data'=>null));
    }
    // The documented minimal response omits the parent ID; membership is scoped by the query.
    if(strpos($path,'/master-data/district')!==false){check(($query['province_id']??'')==='211','province-scoped district lookup');return response(200,array('code'=>200,'data'=>array(array('DistrictID'=>1929,'DistrictName'=>'Fixture district'))));}
    if(strpos($path,'/master-data/ward')!==false){check(($query['district_id']??'')==='1929','district-scoped ward lookup');$row=array('WardCode'=>$scenario==='address-invalid'?'OTHER':'490707','WardName'=>'Fixture ward');if($scenario==='relation-mismatch'){$row['DistrictID']=999;}return response(200,array('code'=>200,'data'=>array($row)));}
    check(substr($path,-strlen('/v2/shipping-order/create'))==='/v2/shipping-order/create','no unexpected HTTP or real HTTP');
    check($args['method']==='POST','create uses POST');$create_count++;
    check($create_count===1,'at most one create');
    check(($db['meta']['_lnl_crm_ghn_create_attempted']??'')==='21496','durable intent before create');
    check(($db['meta']['_lnl_ghn_shipping_ward_code']??'')===$body['to_ward_code'],'address saved before create');
    if($scenario==='selected-address'){check($db['shipping']['address_1']==='Chosen road'&&strpos($body['to_address'],'Chosen road')===0,'selected address persisted before carrier call');}
    check($body['client_order_code']==='21496'&&$body['to_district_id']===1929,'exact client and district');
    check($body['cod_amount']===1000&&$body['insurance_value']===1000,'COD retained');
    check($body['weight']===2500&&$body['length']===33&&$body['width']===21&&$body['height']===10,'package formulas retained');
    check($body['items'][0]['code']==='TEST-EXACT-SKU'&&$body['items'][0]['quantity']===2&&$body['items'][0]['price']===300,'SKU quantity price retained');
    if($scenario==='concurrent'){$nested=call_bridge();check(is_wp_error($nested)&&$nested->get_error_code()==='ghn_reconcile_failed','concurrent call blocked');}
    if(in_array($scenario,array('ghn-rejected','ghn-address-rejected','ghn-empty-message'),true)){
        return response(400,array('code'=>400,'message'=>'<b>Rejected</b> Token=fake-ghn-private-token','code_message_value'=>$scenario==='ghn-empty-message'?' ':($scenario==='ghn-address-rejected'?'Phường không hợp lệ':'Dịch vụ không hỗ trợ; Token=fake-ghn-private-token')));
    }
    if($scenario==='empty-response'){return response(200,array('code'=>200,'data'=>array()));}
    if($scenario==='malformed-response'){return array('response'=>array('code'=>200),'body'=>'not JSON');}
    $carrier=carrier();
    if($scenario==='timeout-found'||$scenario==='timeout-late'){return new WP_Error('http_request_failed','timeout Token=fake-ghn-private-token');}
    return response(200,array('code'=>200,'data'=>$carrier));
}
function call_bridge($params=array()){
    $params=array_merge(array('orderId'=>21496,'action'=>'confirm'),$params);
    return call_user_func($GLOBALS['route'],new WP_REST_Request($params));
}
try {
    if($scenario==='existing'){$db['meta']['_lnl_ghn_order_code']='GHN21496';$db['status']='completed';}
    if($scenario==='invalid-metadata'){$db['meta']['_lnl_ghn_order_code']=array('wrong-type');}
    if($scenario==='found'){$carrier=carrier();}
    if($scenario==='handler-missing'){
        require __DIR__.'/../../handoff/lock-ghn-wordpress/ghn-service.php';
        $result=lnl_crm_ghn_confirm(wc_get_order(21496));
    }else{
        // Evaluates only the PHP template extracted from source, never the JS installer.
        eval($input['bridge']);do_action('rest_api_init');
        if($scenario==='legacy-71'||$scenario==='legacy-125'){
            $id=$scenario==='legacy-71'?'71':'125';
            eval(file_get_contents(__DIR__.'/../../handoff/lock-ghn-wordpress/snippet-'.$id.'-lnl-ghn-auto-create.php'));
            do_action('woocommerce_order_status_processing',21496,wc_get_order(21496));
        }else{check(!function_exists('lnl_ghn_create_order_from_wc_order'),'REST provider independent of inactive snippets');}
        $before=$db;
        $params=array();
        if($scenario==='selected-address'){$params=array('addressLine'=>'Chosen road','provinceId'=>211,'provinceName'=>'Chosen province','districtId'=>1929,'districtName'=>'Chosen district','wardCode'=>'490707','wardName'=>'Chosen ward');}
        if($scenario==='partial-address'){$params=array('addressLine'=>'Chosen road');}
        $result=call_bridge($params);
        if($scenario==='partial-address'){check($db===$before,'invalid partial address is not saved');}
        if($scenario==='existing'){check($db===$before&&count($wire)===0,'existing code replay without writes or HTTP');}
    }
    $first_error=is_wp_error($result)?$result->get_error_code():'';
    $expected=array('handler-missing'=>'ghn_handler_unavailable','config-missing'=>'ghn_handler_unavailable','address-invalid'=>'address_invalid','partial-address'=>'address_invalid','relation-mismatch'=>'address_invalid','invalid-metadata'=>'ghn_reconcile_failed','lock-lost'=>'ghn_reconcile_failed','lock-busy'=>'ghn_reconcile_failed',
        'lookup-unavailable'=>'ghn_reconcile_failed','lookup-ambiguous'=>'ghn_reconcile_failed','lookup-permission'=>'ghn_reconcile_failed','lookup-wrong-client'=>'ghn_reconcile_failed','lookup-wrong-shop'=>'ghn_reconcile_failed',
        'intent-fail'=>'ghn_metadata_persist_failed','intent-drop'=>'ghn_metadata_persist_failed','order-changed'=>'ghn_metadata_persist_failed',
        'persist-throw'=>'ghn_metadata_persist_failed','persist-drop'=>'ghn_metadata_persist_failed','persist-unreadable'=>'ghn_metadata_persist_failed','post-status-fail'=>'ghn_metadata_persist_failed','timeout-late'=>'ghn_reconcile_failed',
        'ghn-rejected'=>'ghn_rejected','ghn-address-rejected'=>'ghn_rejected','ghn-empty-message'=>'ghn_rejected','empty-response'=>'ghn_response_missing_order_code','malformed-response'=>'ghn_response_missing_order_code');
    if(isset($expected[$scenario])){
        check(is_wp_error($result)&&$first_error===$expected[$scenario],'specific error code');
        check(strpos($result->get_error_message(),'fake-ghn-private-token')===false,'error secret sanitized');
        if($scenario==='ghn-empty-message'){check(strpos($result->get_error_message(),'Rejected')!==false,'empty code message falls back to message');}
        if(in_array($scenario,array('empty-response','malformed-response'),true)){
            $phase=1;$again=call_bridge();check(is_wp_error($again)&&$again->get_error_code()==='ghn_reconcile_failed'&&$create_count===1,'uncertain response blocks another create');
        }
        if($scenario==='post-status-fail'){$phase=1;$again=call_bridge();check(!is_wp_error($again)&&$again['ghnOrderCode']==='GHN21496'&&$create_count===1,'status retry uses saved code');}
        if(in_array($scenario,array('persist-throw','persist-drop','persist-unreadable','timeout-late'),true)){
            check(empty($db['meta']['_lnl_ghn_order_code']),'no false success persisted');
            $phase=1;$GLOBALS['renumbered']='CHANGED-NUMBER';$result=call_bridge();
            check(!is_wp_error($result)&&$result['ghnOrderCode']==='GHN21496'&&$create_count===1,'reconcile and save same code, no second create');
        }
    }else{
        check(!is_wp_error($result)&&$result['ghnOrderCode']==='GHN21496','success returns saved carrier code');
        check(($db['meta']['_lnl_ghn_order_code']??'')==='GHN21496','Woo saved actual code');
        $count=$create_count;$again=call_bridge();check(!is_wp_error($again)&&$again['ghnOrderCode']==='GHN21496'&&$create_count===$count,'replay no second create');
        ob_start();lnl_crm_ghn_display_code(wc_get_order(21496));$html=ob_get_clean();check(strpos($html,'GHN21496')!==false,'website displays saved number');
    }
    $no_create=array('handler-missing','config-missing','address-invalid','partial-address','relation-mismatch','invalid-metadata','lock-lost','lock-busy','existing','found','lookup-unavailable','lookup-ambiguous','lookup-permission','lookup-wrong-client','lookup-wrong-shop','intent-fail','intent-drop','order-changed');
    if(in_array($scenario,$no_create,true)){check($create_count===0,'must not create');}
    check($wpdb->held===false,'lock always released');
    echo json_encode(array('ok'=>true,'checks'=>$checks,'creates'=>$create_count,'first_error'=>$first_error));
}catch(Throwable $e){fwrite(STDERR,'Fixture failed: '.$e->getMessage()."\n");exit(1);}
