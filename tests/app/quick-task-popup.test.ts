import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
const {quickTaskDeadline}=await import(new URL('../../trial-ui/tasks.js',import.meta.url).href);
test('quick task deadline supports today, tomorrow and seven days across month/year boundaries',()=>{assert.equal(quickTaskDeadline('0','2026-11-08'),'2026-11-08');assert.equal(quickTaskDeadline('1','2026-11-30'),'2026-12-01');assert.equal(quickTaskDeadline('7','2026-12-28'),'2027-01-04');});
test('quick task no-deadline choice clears an earlier due date',()=>{assert.equal(quickTaskDeadline('','2026-11-08'),'');});
