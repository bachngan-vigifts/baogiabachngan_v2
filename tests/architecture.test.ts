import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';

/**
 * Luật phụ thuộc giữa các module (chống rối khi phát triển tiếp).
 * Chỉ được import theo chiều: module nghiệp vụ -> staff -> core. Không có vòng.
 */
const modulesDir = join(import.meta.dirname, '..', 'src', 'modules');
const ALLOWED: Record<string, string[]> = {
  staff: [], customers: ['staff'], catalog: ['staff'], contracts: [], printing: ['staff', 'quotes'], integrations: ['staff', 'customers', 'catalog'], crm: [],
  sales: ['staff', 'customers', 'quotes', 'contracts'],
  quotes: ['staff'], work: ['staff'], notifications: ['staff'], suppliers: ['staff'],
};

test('schema của mỗi module chỉ import module được phép', () => {
  for (const mod of readdirSync(modulesDir)) {
    const file = join(modulesDir, mod, 'schema.ts');
    if (!existsSync(file)) continue;
    const deps = [...readFileSync(file, 'utf8').matchAll(/from '\.\.\/([a-z-]+)\//g)].map(m => m[1]!);
    for (const d of deps) assert.ok((ALLOWED[mod] ?? []).includes(d), `${mod} không được import ${d}`);
  }
});

test('không có vòng phụ thuộc', () => {
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (m: string, path: string[]) => {
    assert.ok(!visiting.has(m), `vòng: ${[...path, m].join(' -> ')}`);
    if (done.has(m)) return;
    visiting.add(m); for (const d of ALLOWED[m] ?? []) visit(d, [...path, m]); visiting.delete(m); done.add(m);
  };
  Object.keys(ALLOWED).forEach(m => visit(m, []));
});

test('core không import module nghiệp vụ (hạ tầng không được biết nghiệp vụ)', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  for (const file of walk(join(modulesDir, '..', 'core')).filter(f => f.endsWith('.ts'))) {
    assert.ok(!/from '[^']*\/modules\//.test(readFileSync(file, 'utf8')), `${file} import từ modules/`);
  }
});

test('domain/ của mọi module không import hạ tầng web/DB (giữ hàm thuần, test không cần môi trường)', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  for (const mod of readdirSync(modulesDir)) {
    const dir = join(modulesDir, mod, 'domain');
    if (!existsSync(dir)) continue;
    for (const file of walk(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = readFileSync(file, 'utf8');
      assert.ok(!/from '[^']*(drizzle-orm|\/http\/|\/db\/|node:sqlite)/.test(src), `${file} phụ thuộc hạ tầng`);
    }
  }
});

test('MỌI file (không chỉ schema) của một module chỉ import module được phép', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  for (const mod of readdirSync(modulesDir)) {
    for (const file of walk(join(modulesDir, mod)).filter(f => f.endsWith('.ts'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/from '(\.[^']*)'/g)) {
        const target = resolve(dirname(file), m[1]!);
        const rel = relative(modulesDir, target).split(sep);
        if (rel[0] === '..' || rel[0] === undefined) continue; // ngoài modules/ (vd core)
        assert.ok(rel[0] === mod || (ALLOWED[mod] ?? []).includes(rel[0]), `${relative(modulesDir, file)} import ${rel[0]} (không được phép)`);
      }
    }
  }
});
