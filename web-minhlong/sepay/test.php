<?php
function assert_same($a,$b,$m){if($a!==$b){fwrite(STDERR,"FAIL $m\n");exit(1);}}
function code($id){return 'ML'.abs((int)$id);} assert_same(code(123),'ML123','unique prefix');
function match_code($s){return preg_match('/(?<![A-Z0-9])ML(\d+)(?![A-Z0-9])/i',$s,$m)?(int)$m[1]:0;}
assert_same(match_code('ML123'),123,'exact code'); assert_same(match_code('DH123'),0,'Lock code rejected'); assert_same(match_code('xML1234y'),0,'embedded code rejected');
function valid($p,$total){$acct=preg_replace('/\D/','',(string)($p['accountNumber']??''));return strtolower($p['transferType']??'')==='in'&&strtoupper($p['gateway']??'')==='ACB'&&$acct==='579268'&&abs(($p['transferAmount']??0)-$total)<0.0001&&match_code($p['content']??'')>0;}
$ok=['transferType'=>'in','gateway'=>'ACB','accountNumber'=>'579268','transferAmount'=>100000,'content'=>'ML123'];
assert_same(valid($ok,100000),true,'valid'); foreach(['accountNumber'=>'159063909','transferAmount'=>99999,'content'=>'DH123','gateway'=>'VCB','transferType'=>'out'] as $k=>$v){$x=$ok;$x[$k]=$v;assert_same(valid($x,100000),false,"reject $k");}
echo "ML_SEPAY_ISOLATED_RULES_OK\n";
