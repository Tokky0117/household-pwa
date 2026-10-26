/**
 * Read-only HTTPS contract. Pure logic: verifier and sheet reader are injected.
 * No direct GAS calls and no write methods. Trial only, not production approved.
 */
export const SHEETS={
 households:['household_id','display_name','version','updated_at'],
 users:['user_id','household_id','display_name','auth_subject'],
 categories:['category_id','name','fixed_order'],
 item_groups:['item_group_id','household_id','category_id','name','normalized_name','in_stock','sort_order','is_hidden','version','created_at','updated_at','deleted_at'],
 products:['product_id','household_id','item_group_id','name','normalized_name','package_quantity','package_unit','item_group_order','version','created_at','updated_at','deleted_at'],
 stores:['chain_id','household_id','canonical_name','normalized_name','aliases','version','updated_at'],
 change_log:['change_id','sequence_no','household_id','entity_type','entity_id','action','occurred_at']
};
const CATEGORY_NAMES=['飲食','キッチン','洗面・風呂','洗濯・掃除','その他'];
const MAX_ROWS=5000;
const reply=(status,body,extra={})=>({status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra},body:JSON.stringify(body)});
const error=(status,code,headers)=>reply(status,{ok:false,error:{code}},headers);
const equivalent=(v)=>String(v??'').toLowerCase()==='true';
const validIdentifier=v=>typeof v==='string'&&/^[0-9]+$/.test(v);
const getBody=(rows,name)=>{
 const columns=SHEETS[name];
 if(!Array.isArray(rows)||!rows.length||!Array.isArray(rows[0])||
    columns.some((c,i)=>rows[0][i]!==c)||rows.length>MAX_ROWS+1)
  throw Error('SHEET_SCHEMA_INVALID');
 return rows.slice(1).filter(row=>Array.isArray(row)&&row.some(v=>v!==''&&v!==null))
  .map(row=>Object.fromEntries(columns.map((col,i)=>[col,row[i]??''])));
};
/**
 * Deployment defense: an isolated test backend cannot be pointed at real
 * multi-user household data by accident. The generic contract is separately
 * tested against multi-household fixtures; the running trial remains isolated.
 */
export function assertIsolatedTrialTables(raw){
 const homes=getBody(raw.households,'households');
 const users=getBody(raw.users,'users');
 if(homes.length!==1||users.length!==1||
    String(homes[0].display_name)!=='[KURASHI_WRITE_TRIAL_ONLY]'||
    !String(homes[0].household_id||'')||
    String(users[0].household_id)!==String(homes[0].household_id)||
    !validIdentifier(String(users[0].auth_subject||'')))
  throw Error('TRIAL_NOT_ISOLATED');
 const householdId=String(homes[0].household_id);
 // A trial-marked home is not sufficient if another household's rows were
 // accidentally copied into this spreadsheet. Refuse the whole dataset.
 for(const table of ['item_groups','products','stores','change_log']){
  const records=getBody(raw[table],table);
  if(records.some(row=>String(row.household_id)!==householdId))
   throw Error('TRIAL_NOT_ISOLATED');
 }
 return true;
}
export function bootstrapFromRows(raw,claims,expectedAudience){
 if(!claims||claims.aud!==expectedAudience||!validIdentifier(claims.sub)||
    !['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||
    !Number.isFinite(Number(claims.exp))||Number(claims.exp)*1000<=Date.now())
  throw Error('UNAUTHORIZED');
 const tables={};
 for(const key of Object.keys(SHEETS))tables[key]=getBody(raw[key],key);
 const matches=tables.users.filter(row=>String(row.auth_subject)===claims.sub);
 if(matches.length!==1)throw Error('FORBIDDEN');
 const home=String(matches[0].household_id||'');
 if(!home||tables.households.filter(row=>String(row.household_id)===home).length!==1)
  throw Error('FORBIDDEN');
 if(tables.categories.length!==5||
  tables.categories.some((row,i)=>String(row.name)!==CATEGORY_NAMES[i]||
    Number(row.category_id)!==i||Number(row.fixed_order)!==i+1))
  throw Error('SHEET_SCHEMA_INVALID');
 const scoped=(name)=>tables[name].filter(row=>String(row.household_id)===home&&
   (!Object.hasOwn(row,'deleted_at')||!row.deleted_at));
 const items=scoped('item_groups');
 const products=scoped('products');
 const stores=scoped('stores');
 const sequence=tables.change_log.filter(row=>String(row.household_id)===home)
  .reduce((value,row)=>Math.max(value,Number(row.sequence_no)||0),0);
 return {household_id:home,categories:tables.categories,
  item_groups:items,products,stores,sequence_no:sequence};
}
/**
 * A transport-agnostic handler. The production adapter MUST verify signature,
 * issuer, audience and expiry with Google's verifier. Never trust JWT parsing.
 */
export function createReadOnlyHandler({origin,audience,verifyIdToken,readTables}){
 let parsedOrigin;
 try{parsedOrigin=new URL(origin)}catch{throw Error('BACKEND_CONFIG_INVALID')}
 if(parsedOrigin.protocol!=='https:'||parsedOrigin.origin!==origin.replace(/\/$/,'')||
  parsedOrigin.username||parsedOrigin.password||
  (parsedOrigin.pathname!=='/'&&parsedOrigin.pathname!=='')||
  parsedOrigin.search||parsedOrigin.hash||!audience||
  typeof verifyIdToken!=='function'||typeof readTables!=='function')
  throw Error('BACKEND_CONFIG_INVALID');
 const allowOrigin=parsedOrigin.origin;
 return async function handle({method,path,headers={}}){
  const common={'Access-Control-Allow-Origin':allowOrigin,'Vary':'Origin'};
  if(headers.origin!==allowOrigin)return error(403,'ORIGIN_DENIED');
  if(method==='OPTIONS'&&path==='/v1/bootstrap')
   return {status:204,headers:{...common,'Cache-Control':'no-store',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type',
    'Access-Control-Max-Age':'600'},body:''};
  // Even the authenticated user cannot mutate a sheet via this service.
  if(path!=='/v1/bootstrap'||method!=='POST')return error(404,'NOT_FOUND',common);
  const auth=headers.authorization;
  if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9._-]{100,6000}$/.test(auth))
   return error(401,'UNAUTHORIZED',common);
  const idToken=auth.slice(7);
  try{
   const claims=await verifyIdToken(idToken,audience);
   if(!claims||claims.aud!==audience||!validIdentifier(claims.sub)||
      !['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||
      !Number.isFinite(Number(claims.exp))||Number(claims.exp)*1000<=Date.now())
    return error(401,'UNAUTHORIZED',common);
   const tables=await readTables();
   return reply(200,{ok:true,data:bootstrapFromRows(tables,claims,audience)},common);
  }catch(e){
   // Fail closed: never return credentials, Sheets data, or upstream errors.
   if(e?.message==='UNAUTHORIZED')return error(401,'UNAUTHORIZED',common);
   if(e?.message==='FORBIDDEN')return error(403,'FORBIDDEN',common);
   return error(503,'BACKEND_UNAVAILABLE',common);
  }
 };
}
