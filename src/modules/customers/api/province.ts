import {sql,type SQLWrapper} from 'drizzle-orm';
import {foldSql} from '../../../core/text/fold.ts';
import {provinceAliases,provincePattern} from '../domain/province.ts';

/** Same normalization/matching as the detail projection; runs before pagination and counts. */
export function provinceCodeSql(address:SQLWrapper){
 const folded=sql`regexp_replace(regexp_replace(${foldSql(sql`regexp_replace(coalesce(${address},''), '[\\r\\n]+', ',', 'g')`)}, '[.()–—/-]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')`;
 const normalized=sql`btrim(regexp_replace(regexp_replace(regexp_replace(${folded}, '[,; ]+(viet nam|vietnam|vn)[,; ]*$', ''), '[,; ]+[0-9]{5,6}[,; ]*$', ''), '[,; ]+$', ''))`;
 const values=sql.join(provinceAliases.map(p=>sql`(${p.alias}::text,${p.code}::text)`),sql`, `);
 return sql<string|null>`(select case when count(distinct p.code)=1 then min(p.code) else null end from regexp_matches(${normalized},${provincePattern},'g') as matches(hit) join (values ${values}) as p(alias,code) on coalesce(hit[2],hit[3])=p.alias)`;
}
