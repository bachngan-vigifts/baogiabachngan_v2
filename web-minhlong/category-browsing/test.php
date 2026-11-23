<?php
define('ABSPATH', __DIR__);
$hooks=array();$active=true;$requested='';$admin=false;
function add_filter($name,$cb,$priority=10,$argc=1){global $hooks;$hooks[$name][]=$cb;}
function add_action($name,$cb,$priority=10,$argc=1){}
function is_admin(){global $admin;return $admin;}
function home_url($path='/'){return 'https://minhlongonline.com'.$path;}
function wp_parse_url($s,$part){return parse_url($s,$part);}
function is_product_category($slug){global $active;return $active;}
function sanitize_key($s){return preg_replace('/[^a-z0-9_-]/','',strtolower($s));}
function wp_unslash($s){return $s;}
function mlpo_eligible($p){return true;}
function get_term_by($a,$b,$c){return (object)array('term_taxonomy_id'=>77);}
function is_wp_error($v){return false;}
class DB {
 public $prefix='wp_',$posts='wp_posts',$term_relationships='wp_term_relationships';
 function prepare($sql,...$args){foreach($args as $arg){$sql=preg_replace('/%[sd]/',is_int($arg)?(string)$arg:"'".str_replace("'","''",$arg)."'",$sql,1);}return $sql;}
}
class Query {
 public $main=true;
 function is_main_query(){return $this->main;}
 function is_tax($tax,$slug){return true;}
}
$wpdb=new DB;
require __DIR__.'/ml-category-browsing.php';
function check($v,$m){if(!$v)throw new Exception($m);}
$default=$hooks['woocommerce_default_catalog_orderby'][0];
$args=$hooks['woocommerce_get_catalog_ordering_args'][0];
$clauses=$hooks['posts_clauses'][0];
check($default('price')==='date','default date');
check($args(array('orderby'=>'meta_value_num','order'=>'ASC','meta_key'=>'_price'))===array('orderby'=>'date','order'=>'DESC','meta_key'=>''),'remove legacy price default');
$q=new Query;$base=array('join'=>'','orderby'=>'wp_posts.price ASC');
$cases=array();
foreach(array('','date','price','price-desc') as $mode){
 $_GET['orderby']=$mode;$b=$base;if($mode==='price-desc')$b['orderby']='wp_posts.price DESC';
 $cases[$mode?:'default']=$clauses($b,$q);
}
$_GET['orderby']='price';check($args(array('orderby'=>'price'))===array('orderby'=>'price'),'explicit choice preserved');
$q->main=false;check($clauses($base,$q)===$base,'secondary queries unchanged');$q->main=true;
$active=false;check($default('price')==='price','other categories keep default');check($clauses($base,$q)===$base,'other categories unchanged');
$active=true;$admin=true;check($clauses($base,$q)===$base,'admin unchanged');
echo json_encode($cases);
