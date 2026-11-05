import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { prepareAppsheetBatches } from '../src/modules/customers/domain/appsheet-export.ts';

// Offline preparation only. No database connection, AppSheet key or customer payload in stdout.
const args=process.argv.slice(2), options:Record<string,string>={};
for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--mapping','--customers','--contacts','--out'].includes(key)||!value||Object.hasOwn(options,key))throw new Error('Dùng --mapping config.json --customers customers.json --contacts contacts.json --out /tmp/appsheet-ready');options[key]=value;}
if(Object.keys(options).length!==4)throw new Error('Cần đủ --mapping, --customers, --contacts, --out.');
const read=(key:string):unknown=>{try{return JSON.parse(readFileSync(resolve(options[key]!),'utf8'));}catch{throw new Error('Không đọc được file JSON cho '+key);}};
const batches=prepareAppsheetBatches(read('--mapping'),read('--customers'),read('--contacts'));
const dir=resolve(options['--out']!);mkdirSync(dir,{mode:0o700}); // Exclusive destination: never overwrite a previous export.
for(const [i,batch] of batches.entries())writeFileSync(join(dir,String(i+1).padStart(4,'0')+'.json'),JSON.stringify(batch,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(`Đã chuẩn bị ${batches.length} lô. Nhập theo thứ tự số file; đối soát lô khách trước lô liên hệ.`);
