import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const setup=fs.readFileSync(new URL('../gas/Setup.gs',import.meta.url),'utf8');
const code=fs.readFileSync(new URL('../gas/Api.gs',import.meta.url),'utf8');
const schema=vm.runInNewContext(setup+'; KURASHI_NEW_SCHEMA',{});
const deep=x=>JSON.parse(JSON.stringify(x));
class MockBook{
 constructor(id){this.id=id;this.tables=new Map();}
 getId(){return this.id}
 getSheets(){return [...this.tables.keys()].map(name=>this.getSheetByName(name))}
 deleteSheet(sh){this.tables.delete(sh.name)}
 getSheetByName(name){
  if(!this.tables.has(name))return null;
  const book=this;
  return {name,getName(){return this.name},
   getLastRow(){return book.tables.get(this.name).length},
   getLastColumn(){return book.tables.get(this.name)[0].length},
   getRange(r,c,n,w){const sheetName=this.name;
    return {getValues(){const t=book.tables.get(sheetName);return Array.from({length:n},(_,i)=>
     Array.from({length:w},(_,j)=>t[r+i-1]?.[c+j-1]??''))},
     setValues(matrix){const t=book.tables.get(sheetName);
      for(let i=0;i<matrix.length;i++){
       const ix=r+i-1,row=t[ix]||Array(t[0].length).fill('');
       for(let j=0;j<matrix[i].length;j++)row[c+j-1]=matrix[i][j];
       t[ix]=row;
      }
     }};
   },
   setName(value){if(book.tables.has(value))throw Error('SHEET_NAME_EXISTS');
    const t=book.tables.get(this.name);book.tables.delete(this.name);book.tables.set(value,t);this.name=value;return this},
   copyTo(dest){const copyName='Copy_'+this.name;
    dest.tables.set(copyName,deep(book.tables.get(this.name)));
    return dest.getSheetByName(copyName);}
  };
 }
}
const trial=new MockBook('trial');
for(const [name,headers] of Object.entries(schema)){
 trial.tables.set(name,[deep(name==='household_items'?[...headers.slice(0,-1),'stock_management_enabled']:
  name==='products'?[...headers,'merged_into_product_id']:
  name==='record_items'?[...headers,'purchase_package_quantity','purchase_package_unit','price_eligible']:headers)]);
}
function add(name,obj){const h=trial.tables.get(name)[0];trial.tables.get(name).push(h.map(k=>obj[k]??''))}
add('households',{household_id:'h1',display_name:'試作',version:1});
for(const [id,name,order] of [[0,'食品・飲料',1],[1,'キッチン',3],[2,'洗面・風呂',4],[3,'洗濯・掃除',5],[4,'その他',6],[5,'調味料',2]])
 add('categories',{category_id:id,name,fixed_order:order});
add('retail_chains',{chain_id:'chain1',household_id:'h1',canonical_name:'コノミヤ',normalized_name:'コノミヤ',aliases:'[]',version:1});
add('household_items',{household_item_id:'item-1',household_id:'h1',category_id:3,name:'洗濯洗剤',normalized_name:'洗濯洗剤',
 in_stock:true,sort_order:1,is_hidden:false,sub_name:'詰替用優先',stock_management_enabled:true,version:1});
add('household_items',{household_item_id:'item-2',household_id:'h1',category_id:1,name:'袋',normalized_name:'袋',
 in_stock:false,sort_order:1,is_hidden:false,sub_name:'野菜用',stock_management_enabled:false,version:1});
add('household_items',{household_item_id:'item-3',household_id:'h1',category_id:1,name:'袋',normalized_name:'袋',
 in_stock:true,sort_order:2,is_hidden:false,sub_name:'生ごみ用',stock_management_enabled:true,version:1});
for(const [id,name,item,qty,unit] of [['product-1','アタックZERO','item-1',580,'g'],['product-2','NANOX','item-1',900,'g'],['product-3','キットカット','',null,null]]){
 add('products',{product_id:id,household_id:'h1',household_item_id:item,name,normalized_name:name,
  package_quantity:qty??'',package_unit:unit??'',household_item_order:item?1:'',version:1});
}
add('records',{record_id:'record-1',household_id:'h1',record_type:'receipt',chain_id:'chain1',
 record_date:'2026-11-21',version:1});
add('record_items',{record_item_id:'recorditem-1',record_id:'record-1',line_order:1,linked_product_id:'product-1',
 quantity:1,line_total_tax_included:400,version:1,non_ocr_name:'アタックZERO',
 purchase_package_quantity:580,purchase_package_unit:'g',price_eligible:true});
const backups=new Map(),books=new Map([['trial',trial]]);
let uuid=0,locked=false;
const props={SPREADSHEET_ID:'trial',KURASHI_NEW_WORKBOOK_ID:'trial',KURASHI_SCHEMA_VERSION:'1'};
const context=vm.createContext({
 SpreadsheetApp:{
  openById:id=>{const book=books.get(id);assert.ok(book,'unknown workbook '+id);return book},
  create:name=>{const b=new MockBook('backup-'+(++uuid));b.tables.set('Sheet1',[['']]);books.set(b.id,b);backups.set(b.id,name);return b}
 },
 LockService:{getScriptLock:()=>({tryLock:()=>!locked&&(locked=true),releaseLock:()=>{locked=false}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??'',setProperty:(k,v)=>{props[k]=String(v)}})},
 Utilities:{getUuid:()=>String(++uuid).padStart(6,'0'),
  DigestAlgorithm:{SHA_256:1},computeDigest:(_,s)=>[...s].map(c=>c.charCodeAt(0)&255)},
 ContentService:{MimeType:{JSON:1},createTextOutput:x=>({setMimeType:()=>({text:x})})},
 console:{log:()=>{}}
});
vm.runInContext(setup+'\n'+code,context);
const call=(action,payload,operation_id)=>JSON.parse(context.doPost({postData:{
 contents:JSON.stringify({action,payload,...(operation_id?{operation_id}:{})})}}).text);
const dry=context.kurashiTrialStockPreflight();
assert.equal(dry.status,'DRY_RUN_OK');
assert.equal(dry.product_count,3);
assert.equal(dry.orphan_items_to_create,2);
assert.equal(dry.former_shared_groups,1);
assert.equal(props.KURASHI_PRODUCT_STOCK_VERSION,undefined,'preflight never edits Sheets');
assert.equal(call('bootstrap',{}).data.capabilities.product_stock_v2,false);
const migrated=context.kurashiTrialStockMigrate();
assert.equal(migrated.status,'PRODUCT_STOCK_V2_READY');
assert.equal(migrated.orphan_products_created,2);
assert.equal(trial.tables.get('products')[0][schema.products.length],'merged_into_product_id');
assert.equal(trial.tables.get('products')[0][schema.products.length+1],'category_id',
 'new stock columns must follow the existing merge metadata, not overwrite it');
assert.equal(trial.tables.get('record_items')[0][schema.record_items.length],'purchase_package_quantity');
assert.equal(trial.tables.get('record_items')[0][schema.record_items.length+2],'price_eligible');
assert.equal(trial.tables.get('record_items')[0][schema.record_items.length+3],'purchase_size_quantity',
 'v98 receipt size columns must follow the old trial package and eligibility fields');
assert.equal(props.KURASHI_PRODUCT_STOCK_VERSION,'2');
assert.ok(props.KURASHI_STOCK_BACKUP_ID&&backups.has(props.KURASHI_STOCK_BACKUP_ID));
assert.equal(props.KURASHI_STOCK_BACKUP_VERIFIED,'yes');
assert.equal(context.kurashiTrialStockVerify().status,'VERIFIED');
const backup=books.get(props.KURASHI_STOCK_BACKUP_ID);
assert.equal(backup.getSheets().length,trial.getSheets().length);
assert.equal(backup.tables.get('products').length,4,'backup kept exactly the original three products');
assert.equal(context.kurashiTrialStockMigrate().status,'ALREADY_READY','replay never duplicates orphan product');
const bootstrap=call('bootstrap',{}).data;
assert.equal(bootstrap.capabilities.product_stock_v2,true);
assert.equal(bootstrap.record_items[0].linked_product_id,'product-1');
assert.equal(bootstrap.record_items[0].purchase_package_quantity,580);
assert.equal(bootstrap.record_items[0].purchase_size_quantity,580,
 'legacy receipt package size must appear through the canonical v98 size field');
assert.equal(bootstrap.products.length,5);
assert.equal(bootstrap.products.find(x=>x.product_id==='product-1').display_group,'洗濯洗剤');
assert.equal(bootstrap.products.find(x=>x.product_id==='product-2').in_stock,true);
assert.equal(bootstrap.products.find(x=>x.product_id==='product-3').stock_enabled,false);
assert.ok(bootstrap.products.find(x=>x.name==='袋（野菜用）'&&x.memo==='野菜用'));
assert.ok(bootstrap.products.find(x=>x.name==='袋（生ごみ用）'&&x.memo==='生ごみ用'));
assert.ok(bootstrap.products.filter(x=>x.display_group==='袋').length===2);
assert.equal(bootstrap.products.find(x=>x.name==='袋（野菜用）').stock_enabled,false,
 'legacy stock_management_enabled=false must be preserved');
assert.equal(bootstrap.products.find(x=>x.name==='袋（生ごみ用）').in_stock,true,
 'same name + different sub-name must preserve independent stock state');
const updated=call('product.stock.update',{product_id:'product-2',version:1,in_stock:false},
 'op-v98-stock-test-012345678901');
assert.equal(updated.ok,true,JSON.stringify(updated.error));
assert.equal(updated.data.entity.in_stock,false);
assert.equal(call('product.stock.update',{product_id:'product-2',version:1,in_stock:false},
 'op-v98-stock-test-012345678901').ok,true,'durable retries return the original operation');
const after=call('bootstrap',{}).data;
assert.equal(after.products.find(x=>x.product_id==='product-1').in_stock,true);
assert.equal(after.products.find(x=>x.product_id==='product-2').in_stock,false);
const ids=['product-2','product-1'],versions=ids.map(id=>after.products.find(x=>x.product_id===id).version);
const reordered=call('product.stock.reorder',{category_id:3,product_ids:ids,versions},'op-v98-reorder-test-0123456789');
assert.equal(reordered.ok,true,JSON.stringify(reordered.error));
assert.deepEqual(Array.from(reordered.data.entities,x=>x.product_id),ids);
assert.equal(reordered.data.entities[0].sort_order,1);
assert.equal(reordered.data.entities[1].sort_order,2);
const groupedBefore=call('bootstrap',{}).data;
const groupIds=['product-1','product-2'];
const groupVersions=groupIds.map(id=>groupedBefore.products.find(x=>x.product_id===id).version);
const groupPayload={category_id:3,display_group:'衣類洗剤',product_ids:groupIds,versions:groupVersions};
const group=call('product.stock.group',groupPayload,'op-v98-group-test-012345678901');
assert.equal(group.ok,true,JSON.stringify(group.error));
assert.ok(group.data.entities.every(x=>x.display_group==='衣類洗剤'));
assert.equal(call('product.stock.group',groupPayload,'op-v98-group-test-012345678901').ok,true,
 'retrying group request must never create duplicate grouping or increments');
const groupedAfter=call('bootstrap',{}).data;
assert.equal(groupedAfter.products.find(x=>x.product_id==='product-1').in_stock,true,
 'grouping does not share product stock state');
assert.equal(groupedAfter.products.find(x=>x.product_id==='product-2').in_stock,false);
const ungroupVersion=groupedAfter.products.find(x=>x.product_id==='product-2').version;
const ungroup=call('product.stock.group',{
 category_id:3,display_group:'',product_ids:['product-2'],versions:[ungroupVersion]
},'op-v98-ungroup-test-0123456789');
assert.equal(ungroup.ok,true,JSON.stringify(ungroup.error));
assert.equal(ungroup.data.entities[0].display_group,'');
assert.equal(call('bootstrap',{}).data.products.find(x=>x.product_id==='product-1').display_group,'衣類洗剤');
const record=call('record.create',{record_type:'receipt',chain_id:'chain1',record_date:'2026-11-22',
 items:[{raw_name:'アタックZERO 580g',linked_product_id:'product-1',
  quantity:null,line_total_tax_included:null,purchase_size_quantity:580,purchase_size_unit:'g'}]},
 'op-v98-null-record-0123456789');
assert.equal(record.ok,true,JSON.stringify(record.error));
assert.equal(record.data.items[0].purchase_size_quantity,580);
assert.equal(record.data.items[0].quantity,null);
assert.equal(record.data.items[0].line_total_tax_included,null);
const recordSnapshot=call('bootstrap',{}).data;
assert.ok(recordSnapshot.record_items.some(x=>x.purchase_size_quantity===580&&x.purchase_size_unit==='g'));
assert.equal(recordSnapshot.record_items.find(x=>x.record_item_id===record.data.items[0].record_item_id).quantity,'',
 'unknown quantity must remain blank rather than becoming 0 or 1');
// A changed original cell must be detected, rather than declared restorable.
backup.tables.get('products')[1][3]='TAMPERED_NAME';
assert.throws(()=>context.kurashiTrialStockVerify(),/バックアップと一致しません/);
console.log('v98 trial stock migration, verified backup, immutable history, product CRUD/reorder, null receipt values and size persistence: OK');
