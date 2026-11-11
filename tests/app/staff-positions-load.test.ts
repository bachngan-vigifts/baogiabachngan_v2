import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');

test('Trang Nhân viên tải danh sách nhân viên / chức vụ khi vào trang (mở app từ Trang chủ không tải sẵn)', () => {
  assert.match(app, /if \(view === 'staff' && isManager\(\)\) \{ loadSapoSync\(\); loadMembers\(\); \}/);
});

test('Hộp Thêm / sửa nhân viên tải chức vụ trước khi mở; không tải được thì báo lỗi thay vì để ô Chức vụ trống', () => {
  const open = app.slice(app.indexOf('async function openMember('), app.indexOf('function showMemberPhoto('));
  assert.match(open, /if \(!state\.positions\?\.length\) \{ await loadMembers\(\);/);
  assert.ok(open.indexOf('await loadMembers()') < open.indexOf("$('#member-position').innerHTML"), 'tải chức vụ trước khi dựng ô chọn');
  assert.match(open, /toast\(state\.memberLoadError \|\| 'Chưa tải được danh sách chức vụ/);
});
