import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/customer-detail.js', import.meta.url), 'utf8');
class Node {
  children: Node[] = []; events: Record<string, Function> = {}; style = {}; value = ''; textContent = ''; disabled = false; open = false; removed = false;
  constructor(public tag: string) {}
  set innerHTML(_: string) { throw new Error('Notes must use safe DOM'); }
  append(...nodes: Node[]) { this.children.push(...nodes); } setAttribute() {} focus() {}
  addEventListener(event: string, fn: Function) { this.events[event] = fn; }
  close() { this.open = false; this.events.close?.(); } remove() { this.removed = true; } showModal() { this.open = true; }
}
function setup(canEdit = true) {
  const body = new Node('body'), cards: Node[] = [], st = { seq: 1, id: 'customer-1', d: { customer: { id: 'customer-1' }, generalNote: { text: '<script>unsafe</script>\nGhi chú', revision: 1, updatedAt: null }, access: { canEdit } } };
  let resolve!: Function, reject!: Function, renders = 0; const calls: any[] = [];
  const ctx: any = { st, document: { createElement: (tag: string) => new Node(tag), body }, root: { querySelector: () => ({ before: (node: Node) => cards.push(node) }) },
    when: String, toast() {}, render: () => renders++, api: (...args: any[]) => { calls.push(args); return new Promise((a, b) => { resolve = a; reject = b; }); } };
  runInNewContext(source.slice(source.indexOf('  function renderGeneralNote()'), source.indexOf('  async function open(id)')) + '\nrenderGeneralNote();', ctx);
  return { st, body, cards, calls, get renders() { return renders; }, resolve: (v: any) => resolve(v), reject: (e: any) => reject(e), edit() { cards[0]!.children[0]!.children[1]!.events.click!();
    const dlg = body.children.at(-1)!, form = dlg.children[0]!, text = form.children[1]!.children[0]!.children[0]!, error = form.children[1]!.children[1]!;
    return { dlg, text, error, save: () => form.events.submit!({ preventDefault() {} }) }; } };
}
test('customer notes UI renders literal text safely and hides edit for readers', () => {
  const s = setup(false); assert.equal(s.cards[0]!.children[1]!.textContent, '<script>unsafe</script>\nGhi chú');
  assert.equal(s.cards[0]!.children[0]!.children.length, 1);
});
test('customer notes UI submits revision and keeps text/dialog on server conflict', async () => {
  const s = setup(), form = s.edit(); form.text.value = 'Bản đang sửa'; const pending = form.save();
  assert.equal(s.calls[0][0], '/customers/customer-1/notes'); assert.equal(s.calls[0][2].revision, 1); assert.equal(s.calls[0][2].text, 'Bản đang sửa');
  s.reject(new Error('Ghi chú đã được người khác cập nhật')); await pending;
  assert.equal(form.dlg.open, true); assert.equal(form.text.value, 'Bản đang sửa'); assert.match(form.error.textContent, /người khác/);
});
test('customer notes UI does not apply late save to a different customer page', async () => {
  const s = setup(), form = s.edit(); const pending = form.save(); s.st.seq++; s.st.id = 'customer-2';
  s.resolve({ text: 'Saved', revision: 2 }); await pending;
  assert.equal(s.renders, 0); assert.equal(s.st.d.generalNote.revision, 1); assert.equal(form.dlg.removed, true);
});
