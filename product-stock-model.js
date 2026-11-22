/* くらしストック v0.98 trial product-stock migration planner.
 * Pure functions: no network, storage, DOM, or mutations.
 * Inventory is always per product; display grouping is optional.
 */
(function(root){
 'use strict';
 const norm=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
 const bool=v=>v===true||String(v).toLowerCase()==='true';
 const cat=v=>Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<=5?Number(v):4;
 function draftMigration({products=[],household_items=[],record_items=[]}={}){
  if(!Array.isArray(products)||!Array.isArray(household_items)||!Array.isArray(record_items))
   throw Error('STOCK_PLAN_INVALID_SNAPSHOT');
  const ids=new Set(),oldIds=new Set(),warnings=[],conversions=[],missing=[];
  for(const i of household_items){
   if(!i||typeof i.household_item_id!=='string'||!i.household_item_id||oldIds.has(i.household_item_id))
    throw Error('STOCK_PLAN_INVALID_ITEM_ID');
   oldIds.add(i.household_item_id);
  }
  for(const p of products){
   if(!p||typeof p.product_id!=='string'||!p.product_id||ids.has(p.product_id))
    throw Error('STOCK_PLAN_INVALID_PRODUCT_ID');
   ids.add(p.product_id);
  }
  const mapping=new Map(household_items.map(x=>[x.household_item_id,x]));
  const grouped=new Map();
  for(const p of products){
   if(p.deleted_at)continue;
   const oldId=String(p.household_item_id||'');
   if(!oldId)continue;
   const old=mapping.get(oldId);
   if(!old||old.deleted_at){
    warnings.push({code:'ORPHAN_LINK',product_id:p.product_id,household_item_id:oldId});
    continue;
   }
   const group=grouped.get(oldId)||[];
   group.push(p);grouped.set(oldId,group);
  }
  for(const p of products){
   if(p.deleted_at)continue;
   const oldId=String(p.household_item_id||'');
   const old=mapping.get(oldId);
   const valid=!!old&&!old.deleted_at;
   const shared=valid&&(grouped.get(oldId)?.length||0)>1;
   // Never claim stock is shared after migrating. Old values only seed each
   // product. Every subsequent stock toggle targets that product ID alone.
   const manualStock=p.stock_enabled!==undefined&&p.stock_enabled!==''?
    bool(p.stock_enabled):valid&&!bool(old.is_hidden);
   const manualState=p.in_stock!==undefined&&p.in_stock!==''?
    bool(p.in_stock):valid&&bool(old.in_stock);
   const row={
    product_id:p.product_id,category_id:p.category_id!==undefined&&p.category_id!==''?
     cat(p.category_id):valid?cat(old.category_id):4,
    stock_enabled:manualStock,in_stock:manualState,
    memo:typeof p.memo==='string'?p.memo:valid?String(old.sub_name||''):'',
    display_group:typeof p.display_group==='string'?p.display_group:
     shared?String(old.name||''):'',
    sort_order:Number(p.sort_order)>0?Number(p.sort_order):
     valid?Number(old.sort_order)||0:0,
    is_hidden:p.is_hidden!==undefined&&p.is_hidden!==''?bool(p.is_hidden):false,
    migrated_from_household_item_id:oldId
   };
   conversions.push(row);
   if(shared)warnings.push({code:'SHARED_STOCK_SPLIT',product_id:p.product_id,household_item_id:oldId});
  }
  for(const old of household_items){
   if(old.deleted_at||grouped.has(old.household_item_id))continue;
   missing.push({
    household_item_id:old.household_item_id,name:String(old.name||''),
    category_id:cat(old.category_id),memo:String(old.sub_name||''),
    in_stock:bool(old.in_stock),stock_enabled:!bool(old.is_hidden),
    sort_order:Number(old.sort_order)||0,
    display_group:''
   });
  }
  const receiptIds=new Set(record_items.filter(x=>!x.deleted_at&&x.linked_product_id)
   .map(x=>String(x.linked_product_id)));
  for(const id of receiptIds)if(!ids.has(id))
   warnings.push({code:'MISSING_RECEIPT_PRODUCT',product_id:id});
  const duplicateNames=new Map();
  for(const p of products.filter(x=>!x.deleted_at)){
   const key=norm(p.name);
   if(!key)warnings.push({code:'EMPTY_PRODUCT_NAME',product_id:p.product_id});
   if(!duplicateNames.has(key))duplicateNames.set(key,[]);
   duplicateNames.get(key).push(p.product_id);
  }
  for(const [name,product_ids] of duplicateNames){
   if(name&&product_ids.length>1)warnings.push({code:'DUPLICATE_NAME_REQUIRES_REVIEW',name,product_ids});
  }
  return {conversions,createProductsForOrphanItems:missing,warnings,
   summary:{existingProducts:conversions.length,newProducts:missing.length,
    itemGroupsSplit:[...grouped.values()].filter(x=>x.length>1).length,
    receiptLinksPreserved:record_items.filter(x=>!x.deleted_at&&x.linked_product_id).length}};
 }
 function stockItems(snapshot){
  if(snapshot?.capabilities?.product_stock_v2!==true)return null;
  if(!Array.isArray(snapshot.products))throw Error('STOCK_SNAPSHOT_INVALID');
  return snapshot.products.filter(p=>!p.deleted_at&&bool(p.stock_enabled)&&!bool(p.is_hidden))
   .map(p=>({
    id:p.product_id,name:p.name,subName:String(p.memo||''),
    category:cat(p.category_id),inStock:bool(p.in_stock),
    displayGroup:String(p.display_group||''),hidden:bool(p.is_hidden),
    order:Number(p.sort_order)||0,version:Number(p.version)
   }));
 }
 const model={draftMigration,stockItems};
 if(typeof module==='object'&&module.exports)module.exports=model;
 if(root)root.KurashiProductStockModel=model;
})(typeof window!=='undefined'?window:null);
