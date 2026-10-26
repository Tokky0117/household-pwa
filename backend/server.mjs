/**
 * Optional Cloud Run read-only test service. NOT deployed by this repository.
 * Requires workload identity / ADC and Viewer sharing on one isolated sheet.
 * No service-account key in repository; no writes, no mutation routes.
 */
import http from 'node:http';
import {OAuth2Client} from 'google-auth-library';
import {google} from 'googleapis';
import {SHEETS,createReadOnlyHandler,assertIsolatedTrialTables} from './readonly-contract.mjs';

const origin=process.env.ALLOWED_ORIGIN||'';
const audience=process.env.GOOGLE_CLIENT_ID||'';
const spreadsheetId=process.env.READONLY_SPREADSHEET_ID||'';
const project=process.env.TRIAL_BACKEND_ENABLED==='true';
if(!project||!origin||!audience||!spreadsheetId)
 throw Error('BACKEND_DISABLED: set explicit isolated-trial environment variables');
const verifier=new OAuth2Client(audience);
const sheets=google.sheets({version:'v4',auth:new google.auth.GoogleAuth({
 scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']
})});
const handler=createReadOnlyHandler({
 origin,audience,
 async verifyIdToken(token,expectedAudience){
  const ticket=await verifier.verifyIdToken({idToken:token,audience:expectedAudience});
  return ticket.getPayload();
 },
 async readTables(){
  const ranges=Object.entries(SHEETS).map(([name,columns])=>
   "'"+name+"'!A1:"+String.fromCharCode(64+columns.length)+"5001");
  const response=await sheets.spreadsheets.values.batchGet({
   spreadsheetId,ranges,valueRenderOption:'UNFORMATTED_VALUE'
  });
  const result={};
  for(let i=0;i<ranges.length;i++)result[Object.keys(SHEETS)[i]]=
   response.data.valueRanges?.[i]?.values??[];
  assertIsolatedTrialTables(result);
  return result;
 }
});
const port=Number(process.env.PORT||8080);
http.createServer(async(req,res)=>{
 try{
  const result=await handler({method:req.method,path:req.url||'',
   headers:req.headers});
  res.writeHead(result.status,result.headers);res.end(result.body);
 }catch(_){
  res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({ok:false,error:{code:'BACKEND_UNAVAILABLE'}}));
 }
}).listen(port);
