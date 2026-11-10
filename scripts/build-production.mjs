// Build-time separation for the stable production Pages URL.
// Never allow a production site to silently use the preview/test GAS.
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const file=resolve(process.argv[2]||'');
const supplied=(process.env.PROD_GAS_EXEC_URL||'').trim();
const trial='https://script.google.com/macros/s/AKfycbwn-SfXqRBIjJWVUUIKEsJuaUR6DLAEWbMVR-_rEB3iVZy2zi0ZNSA7JjNmyykvKjvdoQ/exec';
if(supplied&&(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{25,120}\/exec$/.test(supplied)||
 supplied===trial))throw Error('PRODUCTION_GAS_URL_MISSING_OR_TEST_ENDPOINT');
let source=readFileSync(file,'utf8');
const endpoint=/const ENDPOINT='[^']*';/;
const db="const DB_NAME='kurashi-stock-operations-v1'";
const request=' async function request(action,payload={},id=null){';
if(!endpoint.test(source)||!source.includes(db)||!source.includes(request))
 throw Error('PRODUCTION_CLIENT_TEMPLATE_CHANGED');
source=source.replace(endpoint,"const ENDPOINT='"+supplied+"';");
source=source.replace(db,"const DB_NAME='kurashi-stock-operations-production-v1'");
source=source.replace(request,request+
 "\n  if(!ENDPOINT){const e=Error('本番の保存先がまだ設定されていません');e.code='CONFIG_REQUIRED';throw e;}");
if(source.includes(trial)||source.includes(db))
 throw Error('PRODUCTION_ENDPOINT_OR_DATABASE_NOT_ISOLATED');
writeFileSync(file,source);
console.log('Production frontend isolated; backend configured: '+Boolean(supplied));
