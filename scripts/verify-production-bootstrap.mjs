#!/usr/bin/env node
// Verify production /exec bootstrap after GAS update, without logging private rows.
import {readFileSync} from 'node:fs';
const path=process.argv[2];
if(!path)throw Error('BOOTSTRAP_FILE_REQUIRED');
let response;
try{response=JSON.parse(readFileSync(path,'utf8'))}
catch{throw Error('PRODUCTION_BOOTSTRAP_NOT_JSON')}
if(!response||response.ok!==true||!response.data)
 throw Error('PRODUCTION_BOOTSTRAP_FAILED');
const d=response.data;
for(const k of ['household_id','categories','household_items','products',
 'retail_chains','receipt_name_mappings','records','record_items','sequence_no']){
 if(!Object.hasOwn(d,k)||d[k]==null)
  throw Error('PRODUCTION_BOOTSTRAP_MISSING_FIELD:'+k);
}
const expected=['食品・飲料','キッチン','洗面・風呂','洗濯・掃除','その他','調味料'];
const cats=d.categories.map(x=>[Number(x.category_id),String(x.name)]);
if(cats.length!==6||cats.some(([id,name])=>id<0||id>5||name!==expected[id]))
 throw Error('PRODUCTION_BOOTSTRAP_CATEGORY_MISMATCH');
if(d.records.some(x=>!['receipt','price_tag'].includes(x.record_type)))
 throw Error('PRODUCTION_BOOTSTRAP_RECORD_TYPE_MISMATCH');
if(d.record_items.some(x=>!Object.hasOwn(x,'linked_product_id')||
  !Object.hasOwn(x,'line_total_tax_included')))
 throw Error('PRODUCTION_BOOTSTRAP_RECORD_ITEM_SCHEMA_MISMATCH');
if(d.products.some(x=>!Object.hasOwn(x,'household_item_id')))
 throw Error('PRODUCTION_BOOTSTRAP_PRODUCT_SCHEMA_MISMATCH');
console.log('PRODUCTION_V94_BOOTSTRAP_SCHEMA_VERIFIED: fields, six categories, receipt records, item prices OK');
