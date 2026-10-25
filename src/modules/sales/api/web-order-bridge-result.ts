import { AppError } from '../../../core/errors.ts';

const DEFAULTS: Record<string,string> = {
  ghn_handler_unavailable:'Website chưa nạp dịch vụ GHN trong REST. Địa chỉ đã chọn được giữ nguyên.',
  address_invalid:'Địa chỉ người nhận chưa hợp lệ theo danh mục GHN.',
  ghn_rejected:'GHN từ chối tạo vận đơn. Giữ nguyên thông tin và kiểm tra lý do GHN trả về.',
  ghn_response_missing_order_code:'Website không trả mã vận đơn GHN. Chưa rõ kết quả tạo; đối soát theo mã đơn trước khi gửi lại.',
  ghn_reconcile_failed:'Chưa đối soát được kết quả GHN. Giữ nguyên thông tin; chỉ gửi lại sau khi đã kiểm tra vận đơn hiện hữu.',
  ghn_metadata_persist_failed:'Vận đơn GHN đã có nhưng website chưa lưu/xác minh được mã. Chỉ đối soát và lưu lại mã hiện hữu, không tạo vận đơn mới.',
  // Older bridges and the direct Minh Long flow can still return these codes.
  ghn_create_failed:'Website/GHN chưa tạo được vận đơn. Giữ nguyên thông tin và kiểm tra nguyên nhân trước khi thử lại.',
  ghn_empty_response:'Website không trả mã vận đơn GHN. Chưa rõ kết quả tạo; tra cứu vận đơn trước khi gửi lại.',
};
const GHN_ERRORS = new Set(Object.keys(DEFAULTS));
export const validWebGhnCode = (value: unknown): value is string => typeof value==='string' && /^[a-z0-9][a-z0-9_-]{0,99}$/i.test(value);
/** Only allow diagnostic flags in logs; no response bodies, messages, addresses or credentials. */
export async function readWebBridgeResult(response: Response, action: string, context: {orderId:string;source:string}, secrets: (string|undefined)[]) {
  let result: Record<string,unknown> = {};
  try { const body: unknown=await response.json(); if(body && typeof body==='object'&&!Array.isArray(body))result=body as Record<string,unknown>; } catch { /* handled as an empty response */ }
  const declared=typeof result.code==='string'&&/^[a-z0-9_]{1,80}$/i.test(result.code)?result.code:'';
  const failed=!response.ok||result.ok===false||result.success===false||GHN_ERRORS.has(declared);
  const missingCode=action==='confirm'&&!validWebGhnCode(result.ghnOrderCode);
  if(failed||missingCode){
    const code=GHN_ERRORS.has(declared)?declared:action==='confirm'?(failed?'ghn_reconcile_failed':'ghn_response_missing_order_code'):declared;
    const raw=[result.code_message_value,result.message].find((v):v is string=>typeof v==='string'&&!!v.trim())||'';
    let message=raw.replace(/<[^>]*>/g,' ').replace(/\bBearer\s+[^\s,;]+/gi,'Bearer [ẩn]').replace(/\b(token|cookie|authorization|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,'$1=[ẩn]');
    for(const secret of secrets)if(secret)message=message.split(secret).join('[ẩn]');
    // A 2xx without a valid code is never a confirmed shipment, even if its message says success.
    if(!failed&&missingCode)message='';
    console.warn('web_order_bridge_failure',{...context,httpStatus:response.status,code:GHN_ERRORS.has(code)?code:'bridge_error',
      hasOrderCode:validWebGhnCode(result.ghnOrderCode),hasSortCode:!!result.ghnSortCode,hasTotalFee:typeof result.ghnFee==='number',
      hasMessage:typeof result.message==='string',hasCodeMessage:typeof result.code_message_value==='string'});
    throw new AppError(response.status>=500?502:failed?409:502,message.trim().slice(0,500)||DEFAULTS[code]||'Website chưa xử lý được đơn.',code||undefined);
  }
  return result;
}
