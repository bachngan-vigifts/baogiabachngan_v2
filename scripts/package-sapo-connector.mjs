/** Reproducible ZIP with only the three reviewed extension files, no signing key/secrets. */
import {readFileSync, writeFileSync} from 'node:fs';
import {crc32} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const root = new URL('../trial-ui/sapo-connector/', import.meta.url);
export function packageConnector() {
  const entries = [], directory = []; let offset = 0;
  for (const name of ['manifest.json', 'worker.js', 'content.js']) {
    const filename = Buffer.from(name), body = readFileSync(new URL(name, root));
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4);
    local.writeUInt16LE(33,12); local.writeUInt32LE(crc32(body),14);
    local.writeUInt32LE(body.length,18); local.writeUInt32LE(body.length,22); local.writeUInt16LE(filename.length,26);
    entries.push(local, filename, body);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6);
    central.writeUInt16LE(33,14); central.writeUInt32LE(crc32(body),16);
    central.writeUInt32LE(body.length,20); central.writeUInt32LE(body.length,24); central.writeUInt16LE(filename.length,28); central.writeUInt32LE(offset,42);
    directory.push(central, filename); offset += local.length + filename.length + body.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(3,8); end.writeUInt16LE(3,10); end.writeUInt32LE(central.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...entries, central, end]);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(new URL('../trial-ui/sapo-connector.zip', import.meta.url), packageConnector());
