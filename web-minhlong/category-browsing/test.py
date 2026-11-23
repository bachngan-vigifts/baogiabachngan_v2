import json, sqlite3, subprocess
from pathlib import Path
root=Path(__file__).parent
cases=json.loads(subprocess.check_output(['php',str(root/'test.php')]))
db=sqlite3.connect(':memory:')
db.executescript("""
CREATE TABLE wp_posts (ID INTEGER PRIMARY KEY,post_date TEXT,price REAL);
CREATE TABLE wp_wc_product_meta_lookup (product_id INTEGER PRIMARY KEY,stock_status TEXT);
CREATE TABLE wp_term_relationships (object_id INTEGER,term_taxonomy_id INTEGER);
INSERT INTO wp_posts VALUES (1,'2026-10-01',10),(2,'2026-11-01',30),(3,'2026-11-20',1),(4,'2026-11-21',20),(5,'2026-11-01',25);
INSERT INTO wp_wc_product_meta_lookup VALUES (1,'instock'),(2,'instock'),(3,'outofstock'),(4,'outofstock'),(5,'onbackorder');
INSERT INTO wp_term_relationships VALUES (4,77);
""")
expected={'default':[4,5,2,1,3],'date':[4,5,2,1,3],'price':[1,4,5,2,3],'price-desc':[2,5,4,1,3]}
for mode,c in cases.items():
 sql='SELECT wp_posts.ID FROM wp_posts '+c['join']+' ORDER BY '+c['orderby']
 ids=[r[0] for r in db.execute(sql)]
 assert ids==expected[mode],(mode,ids)
 paged=[r[0] for offset in [0,2,4] for r in db.execute(sql+' LIMIT 2 OFFSET '+str(offset))]
 assert paged==ids and len(set(paged))==5
print('PASS: default/newest, price overrides, stable pagination, preorder, scope and admin isolation')
