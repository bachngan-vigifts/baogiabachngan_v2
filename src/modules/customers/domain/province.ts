import { fold } from '../../../core/text/fold.ts';

/** Nghị quyết 202/2025/QH15. Old province names are aliases, never rewritten into the source address.
 * https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/6/202qh.signed.pdf
 */
export const PROVINCES = [
 ['01','Hà Nội',[]],['04','Cao Bằng',[]],['08','Tuyên Quang',['Hà Giang']],['11','Điện Biên',[]],
 ['12','Lai Châu',[]],['14','Sơn La',[]],['15','Lào Cai',['Yên Bái']],['19','Thái Nguyên',['Bắc Kạn']],
 ['20','Lạng Sơn',[]],['22','Quảng Ninh',[]],['24','Bắc Ninh',['Bắc Giang']],['25','Phú Thọ',['Vĩnh Phúc','Hòa Bình']],
 ['31','Hải Phòng',['Hải Dương']],['33','Hưng Yên',['Thái Bình']],['37','Ninh Bình',['Hà Nam','Nam Định']],
 ['38','Thanh Hóa',[]],['40','Nghệ An',[]],['42','Hà Tĩnh',[]],['44','Quảng Trị',['Quảng Bình']],
 ['46','Huế',['Thừa Thiên Huế']],['48','Đà Nẵng',['Quảng Nam']],['51','Quảng Ngãi',['Kon Tum']],
 ['52','Gia Lai',['Bình Định']],['56','Khánh Hòa',['Ninh Thuận']],['66','Đắk Lắk',['Phú Yên','Đăk Lăk','Dak Lak']],
 ['68','Lâm Đồng',['Đắk Nông','Bình Thuận']],['75','Đồng Nai',['Bình Phước']],['79','Hồ Chí Minh',['Bình Dương','Bà Rịa Vũng Tàu','HCM','TPHCM','Sài Gòn']],
 ['80','Tây Ninh',['Long An']],['82','Đồng Tháp',['Tiền Giang']],['86','Vĩnh Long',['Bến Tre','Trà Vinh']],
 ['91','An Giang',['Kiên Giang']],['92','Cần Thơ',['Hậu Giang','Sóc Trăng']],['96','Cà Mau',['Bạc Liêu']],
] as const;
export const provinceOptions = PROVINCES.map(([code,name])=>({code,name})).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
export const normalizeAddress = (address:unknown) => fold(String(address??'').replace(/[\r\n]+/g,',')).replace(/[.()\-–—/]+/g,' ').replace(/\s+/g,' ')
 .replace(/[,; ]+(viet nam|vietnam|vn)[,; ]*$/,'').replace(/[,; ]+[0-9]{5,6}[,; ]*$/,'').replace(/[,; ]+$/,'').trim();

// Whole administrative segments, or an explicit province/city prefix at the end of a long segment.
// A street/ward named after a province is not sufficient. Conflicting province segments stay unknown.
export const provinceAliases=PROVINCES.flatMap(([code,name,old])=>[...new Set([name,...old].map(normalizeAddress))].map(alias=>({code,name,alias})));
const names=provinceAliases.map(p=>p.alias).sort((a,b)=>b.length-a.length).join('|');
export const provincePattern=`(^|[,;] *)(?:tinh +|tp *|thanh pho +)?(${names})(?=[,;]|$)|(?:^| )(?:tinh +|tp *|thanh pho +)(${names})$`;
export function customerProvince(address:unknown){
 const matches=[...normalizeAddress(address).matchAll(new RegExp(provincePattern,'g'))].map(m=>provinceAliases.find(p=>p.alias===(m[2]||m[3]))!).filter(Boolean);
 const codes=new Set(matches.map(p=>p.code));
 return codes.size===1?{code:matches[0]!.code,name:matches[0]!.name}:null;
}
