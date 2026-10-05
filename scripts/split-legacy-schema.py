"""One-off: split the legacy db/schema.ts into per-module schema files.
Keeps every column definition byte-for-byte so existing data stays compatible."""
import re, sys
SRC = '/home/claude/bach-ngan-bao-gia/db/schema.ts'
src = open(SRC, encoding='utf-8').read()

MODULES = {
 'staff': ['positions','employees','credentials','sessions','authAttempts','setup','staffSapoLinks'],
 'quotes': ['quotations','quoteNotifications','notificationReads'],
 'catalog': ['stockImports','productEdits'],
 'customers': ['customers','customerContractProfiles'],
 'contracts': ['contractCounters','contractTransfers','contractStatuses','contractDocumentNumbers'],
 'crm': ['crmTasks','vigiftsApps','vigiftsTables','vigiftsFields','vigiftsRows','vigiftsViews','vigiftsActions','vigiftsBots'],
 'work': ['workBranches','workAssignments','workShifts','workReports','workAudit','workSnapshots','workCashRequests'],
 'notifications': ['webPushSubscriptions','webNotifications','webNotificationReads'],
 'integrations': ['sapoOrderStatuses'],
}
owner = {t: m for m, ts in MODULES.items() for t in ts}

def block(name):
    m = re.search(r'export const %s = sqliteTable\(' % name, src)
    assert m, name
    i = m.end() - 1; depth = 0
    for j in range(i, len(src)):
        c = src[j]
        if c == '(': depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                end = src.index(';', j) + 1
                return src[m.start():end]
    raise SystemExit('unbalanced ' + name)

blocks = {n: block(n) for n in owner}
assert len(blocks) == 37, len(blocks)
for mod, names in MODULES.items():
    body = '\n'.join(blocks[n] for n in names)
    used = set(re.findall(r'\(\) *=> *(\w+)\.', body))
    imports = {}
    for u in used:
        if u in owner and owner[u] != mod:
            imports.setdefault(owner[u], set()).add(u)
    head = "import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';\n"
    for dep, ids in sorted(imports.items()):
        head += "import { %s } from '../%s/schema.ts';\n" % (', '.join(sorted(ids)), dep)
    open(f'src/modules/{mod}/schema.ts', 'w', encoding='utf-8').write(head + '\n' + body + '\n')
    print(mod, len(names), 'tables; imports from', sorted(imports))
