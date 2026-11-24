import {test} from 'node:test';
import ts from 'typescript';
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

// Node tests resolve root package.json, whereas remote Edge upload uses this import map.
// Parse real imports (the CLI regex also matches prose) so Node resolution cannot hide missing Edge mappings.
test('every bare package in the Edge upload graph has a pinned Deno mapping',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),seen=new Set<string>(),packages=new Set<string>();
 function visit(file:string){
  if(seen.has(file))return;seen.add(file);
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const add=(path:string)=>{if(path.startsWith('.'))visit(resolve(dirname(file),path));else if(!/^(?:node:|npm:|https?:)/.test(path))packages.add(path);};
  function walk(node:ts.Node){
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))add(node.moduleSpecifier.text);
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))add(node.arguments[0].text);
   if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal))add(node.argument.literal.text);
   ts.forEachChild(node,walk);
  }
  walk(ast);
 }
 visit(resolve(root,'supabase/functions/baogia-v2-api/index.ts'));
 const {imports}=JSON.parse(readFileSync(resolve(root,'supabase/functions/baogia-v2-api/deno.json'),'utf8'));
 for(const specifier of packages){const mapping=imports[specifier];assert.equal(typeof mapping,'string',`Missing Edge import mapping: ${specifier}`);assert.match(mapping,/^npm:(?:@[^/]+\/)?[^@]+@\d+\.\d+\.\d+(?:\/.*)?$/,`Unpinned Edge import: ${specifier}`);}
 const {dependencies}=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
 for(const name of ['fflate','saxes'])assert.equal(imports[name],`npm:${name}@${dependencies[name]}`,`Node/Edge version mismatch: ${name}`);
});
