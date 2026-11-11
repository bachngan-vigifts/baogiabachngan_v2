import {createHash} from 'node:crypto';
import {AppError} from '../../../core/errors.ts';
import {printingInfo,type QuoteDoc} from '../../quotes/domain/quote-math.ts';
export const PRODUCTION_MAX_BYTES=10*1024*1024,PRODUCTION_MAX_FILES=10;
export const needsProductionFiles=(d:QuoteDoc&{template?:string})=>d.template==='sale'||printingInfo(d).enabled||(['B2B','VIGIFTS'].includes(d.type)&&(d.rows||[]).some(r=>Number(r.qty)>0&&/logo/i.test(r.printDescription||'')&&!/kh[oô]ng\s+in/i.test(r.printDescription||'')));
/** Dedicated production formats; never relax the shared chat/warehouse storage allowlist. */
export function productionFile(name:string,b:Uint8Array){
 name=name.trim();if(!name||name.length>200||/[\x00-\x1f\x7f/\\]/.test(name))throw new AppError(400,'Tên file sản xuất không hợp lệ.');
 if(!b.length||b.length>PRODUCTION_MAX_BYTES)throw new AppError(413,'File sản xuất tối đa 10 MB.');
 const ext=name.split('.').pop()?.toLowerCase(),head=new TextDecoder('latin1').decode(b.subarray(0,1024));
 const checks:Record<string,[string,boolean]>={pdf:['application/pdf',head.startsWith('%PDF-')],ai:['application/postscript',head.startsWith('%PDF-')||head.startsWith('%!PS-Adobe')],psd:['image/vnd.adobe.photoshop',head.startsWith('8BPS')],cdr:['application/vnd.corel-draw',head.startsWith('RIFF')&&head.slice(8,11)==='CDR'],png:['image/png',b[0]===137&&head.slice(1,8)==='PNG\r\n\x1a\n'],jpg:['image/jpeg',b[0]===255&&b[1]===216&&b[2]===255],jpeg:['image/jpeg',b[0]===255&&b[1]===216&&b[2]===255],webp:['image/webp',head.startsWith('RIFF')&&head.slice(8,12)==='WEBP']};
 const found=checks[ext||''];if(!found?.[1])throw new AppError(400,'Chọn PDF, AI (PDF/PostScript), CDR dạng RIFF, PSD, PNG, JPG hoặc WebP đúng định dạng. ZIP, SVG và file thực thi không được nhận.','PRODUCTION_FILE_TYPE');
 return{name,mime:found[0],sha256:createHash('sha256').update(b).digest('hex'),md5:createHash('md5').update(b).digest('hex')};
}
