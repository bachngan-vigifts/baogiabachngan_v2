import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Supabase CLI --use-api uploads only dependencies found by this collector.
// Upstream v2.75.0 pkg/function/deno.go:114. Valid TypeScript such as
// import{...}from'...' is missed because the collector requires import + whitespace.
const pattern=/(?:import|export)\s+(?:{[^{}]+}|.*?)\s*(?:from)?\s*['"](.*?)['"]|import\(\s*['"](.*?)['"]\)/gi;
test('Edge upload graph includes both catalogue domain modules',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),seen=new Set<string>();
 function visit(file:string){if(seen.has(file))return;seen.add(file);const source=readFileSync(file,'utf8');for(const match of source.matchAll(new RegExp(pattern))){const path=match[1]||match[2];if(path?.startsWith('.'))visit(resolve(dirname(file),path));}}
 visit(resolve(root,'supabase/functions/baogia-v2-api/index.ts'));
 for(const path of ['src/modules/catalog/api/catalogue-library.ts','src/modules/catalog/api/catalogue-quotes.ts','src/modules/catalog/api/catalogue-library-bulk.ts','src/modules/catalog/domain/catalogue-data.ts','src/modules/catalog/domain/catalogue-quote.ts'])assert(seen.has(resolve(root,path)),`CLI upload graph omits ${path}`);
});
