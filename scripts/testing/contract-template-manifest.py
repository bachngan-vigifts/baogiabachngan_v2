"""Generate/verify server editable paragraph indexes from the shipped DOCX templates."""
import hashlib, json, re, sys, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
root = Path(__file__).resolve().parents[2]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
result = {}
for brand, file in [('BN', 'mau-hop-dong-bach-ngan-hdkt.docx'), ('VG', 'mau-hop-dong-vigifts-hdkt.docx')]:
    path = root / 'trial-ui' / file
    with zipfile.ZipFile(path) as package:
        xml = ET.fromstring(package.read('word/document.xml'))
    parents = {child: parent for parent in xml.iter() for child in parent}
    paragraphs = []
    for index, p in enumerate(xml.iter(W + 'p')):
        if not list(p.iter(W + 't')) or any(list(p.iter(W + tag)) for tag in ['drawing', 'pict', 'fldChar', 'fldSimple', 'object', 'sdt']):
            continue
        text = ''.join(t.text or '' for t in p.iter(W + 't'))
        parent, in_table = p, False
        while parent in parents:
            parent = parents[parent]
            in_table |= parent.tag == W + 'tbl'
        locked = in_table or bool(re.search(r'<<|>>|Hôm nay,\s*ngày|TP Cần Thơ, ngày|ký ngày|Phương thức thanh toán|5\.2\s*Địa điểm|5\.1\s*Thời gian', text))
        paragraphs.append({'index': index, 'locked': locked})
    result[brand] = {'sourceHash': hashlib.sha256(path.read_bytes()).hexdigest(), 'paragraphs': paragraphs}
path = root / 'src/modules/sales/domain/contract-template-manifest.json'
if '--write' in sys.argv:
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
else:
    assert json.loads(path.read_text()) == result, 'Shipped DOCX changed: review and rebuild template manifest'
print('Template manifest verified: BN, VG')
