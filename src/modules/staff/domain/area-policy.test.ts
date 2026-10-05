import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccessArea, pageRedirect, type Area, type PolicyMember } from './area-policy.ts';

const m = (role: PolicyMember['role'], positionId: string | null = null, active = true): PolicyMember => ({ role, positionId, active });
const areas: Area[] = ['self', 'supplier-portal', 'ncc-admin', 'business'];
const allowed = (member: PolicyMember) => areas.filter(a => canAccessArea(member, a));

test('NCC chỉ vào được tài khoản cá nhân và cổng NCC – không gì khác', () => {
  assert.deepEqual(allowed(m('supplier', 'supplier')), ['self', 'supplier-portal']);
  assert.deepEqual(allowed(m('supplier')), ['self', 'supplier-portal']);
});

test('chức vụ NCC mà vai trò bị lệch (employee/manager) vẫn bị giới hạn như NCC', () => {
  assert.deepEqual(allowed(m('employee', 'supplier')), ['self', 'supplier-portal']);
  assert.deepEqual(allowed(m('manager', 'supplier')), ['self', 'supplier-portal']);
});

test('nhân viên: việc nghiệp vụ + cá nhân, không vào cổng NCC lẫn quản lý NCC; manager vào tất cả', () => {
  assert.deepEqual(allowed(m('employee', 'sale')), ['self', 'business']);
  assert.deepEqual(allowed(m('manager', 'manager')), areas);
});

test('tài khoản bị khoá không vào đâu, kể cả self', () => {
  for (const member of [m('supplier', 'supplier', false), m('employee', 'sale', false), m('manager', 'manager', false)]) assert.deepEqual(allowed(member), []);
  assert.equal(canAccessArea(null, 'self'), false);
  assert.equal(canAccessArea(undefined, 'business'), false);
});

test('chuyển hướng trang (port từ worker): NCC bị đưa về /supplier, nhân viên không vào trang NCC', () => {
  const ncc = m('supplier', 'supplier'), emp = m('employee', 'sale'), mgr = m('manager', 'manager');
  for (const p of ['/', '/quote', '/quote.html', '/index.html', '/customers', '/crm.html', '/staff.html']) assert.equal(pageRedirect(ncc, p), '/supplier', p);
  for (const p of ['/supplier', '/supplier.html', '/login.html']) assert.equal(pageRedirect(ncc, p), null, p);
  assert.equal(pageRedirect(emp, '/supplier'), '/');
  assert.equal(pageRedirect(emp, '/supplier.html'), '/');
  assert.equal(pageRedirect(emp, '/quote'), null);
  assert.equal(pageRedirect(mgr, '/supplier'), null);
  assert.equal(pageRedirect(mgr, '/quote'), null);
  assert.equal(pageRedirect(null, '/quote'), null);
  assert.equal(pageRedirect(m('employee', 'supplier'), '/quote'), '/supplier'); // dữ liệu lệch cũng bị đưa về /supplier
});
