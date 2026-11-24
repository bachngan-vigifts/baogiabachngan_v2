"""Public source-template requirements, derived from the exact shipped Word files."""
import json,hashlib,re,sys,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
root=Path(__file__).resolve().parents[2]
result={}
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
for brand,slug in [('BN','bach-ngan'),('VG','vigifts')]:
 result[brand]={}
 for kind,path in [('HDKT',f'mau-hop-dong-{slug}-hdkt.docx'),('TAM_UNG',f'mau-hop-dong-{slug}-tam-ung.docx'),('BBNT','mau-bien-ban-ban-giao-nghiem-thu.docx')]:
  data=(root/'trial-ui'/path).read_bytes()
  with zipfile.ZipFile(root/'trial-ui'/path) as z: xml=ET.fromstring(z.read('word/document.xml'))
  text='\n'.join(''.join(t.text or '' for t in p.iter(W+'t')) for p in xml.iter(W+'p'))
  goods=any((lambda text:re.search(r'STT',text) and re.search(r'Thành\s*[Tt]iền',text))(''.join(t.text or '' for t in next(iter(tbl.iter(W+'tr')),ET.Element('empty')).iter(W+'t'))) for tbl in xml.iter(W+'tbl'))
  result[brand][kind]={'goodsTable':bool(goods),'path':path,'sourceHash':hashlib.sha256(data).hexdigest(),'fields':sorted(set(re.findall(r'<<.*?>>',text)))}
path=root/'src/modules/sales/domain/contract-source-manifest.json'
if '--write' in sys.argv:path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
else:assert json.loads(path.read_text())==result,'Source Word files changed: review/rebuild manifest'
print('Verified BN/VG HDKT/TAM_UNG/BBNT source requirements')
