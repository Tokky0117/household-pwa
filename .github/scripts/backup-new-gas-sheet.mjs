/**
 * Backup the configured test Google Sheet in Drive before any GAS push.
 * Credentials remain in the GitHub Actions secret; never print tokens or file IDs.
 * A failure terminates the workflow before GAS code or deployment is changed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIME = 'application/vnd.google-apps.spreadsheet';
const ID = /^[A-Za-z0-9_-]{20,180}$/;

async function jsonOrFail(response, step) {
  if (!response || !response.ok) throw Error(step + ': HTTP ' + (response?.status || 'unknown') + ' (check Drive API / OAuth permissions)');
  try {
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('invalid');
    return data;
  } catch {
    throw Error(step + ': invalid API response');
  }
}

export async function backupNewGasSheet({spreadsheetId, credentialsPath, runId, now, fetchImpl}={}) {
  credentialsPath ||= path.join(os.homedir(), '.clasprc.json');
  runId ??= process.env.GITHUB_RUN_ID;
  now ||= new Date();
  fetchImpl ||= fetch;
  if (typeof spreadsheetId !== 'string' || !ID.test(spreadsheetId)) throw Error('GAS_SPREADSHEET_ID_NEW missing/invalid; blocked');
  if (!/^\d{1,20}$/.test(String(runId)) || !Number.isFinite(now.getTime())) throw Error('Invalid backup run ID/date');
  const creds = JSON.parse(fs.readFileSync(credentialsPath,'utf8'));
  const auth = creds.tokens?.default || (creds.token && creds.oauth2ClientSettings && {
    ...creds.token, client_id: creds.oauth2ClientSettings.clientId,
    client_secret: creds.oauth2ClientSettings.clientSecret
  });
  if (!auth?.client_id || !auth?.client_secret || !auth?.refresh_token) throw Error('No refreshable clasp OAuth token');
  const authResponse = await fetchImpl('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:auth.client_id,client_secret:auth.client_secret,
      refresh_token:auth.refresh_token,grant_type:'refresh_token'})
  });
  const fresh = await jsonOrFail(authResponse,'OAuth refresh');
  if (!fresh.access_token) throw Error('OAuth refresh missing access token');
  const headers = {Authorization:'Bearer '+fresh.access_token};
  const base = 'https://www.googleapis.com/drive/v3/files/';
  const api = async (url, opts, label) => jsonOrFail(await fetchImpl(url, opts),label);
  const original = await api(base + encodeURIComponent(spreadsheetId) +
    '?fields=id,name,mimeType,trashed,capabilities(canCopy)',{headers},'Source metadata');
  if (original.id !== spreadsheetId || original.mimeType !== MIME || original.trashed ||
      original.capabilities?.canCopy !== true || !original.name?.trim())
    throw Error('Configured source is not a copyable Google Sheet');
  const timestamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const name=original.name+'__GAS更新前バックアップ_'+timestamp+'_run'+runId;
  const copy=await api(base+encodeURIComponent(spreadsheetId)+
    '/copy?fields=id,name,mimeType,trashed',{
      method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({name})
    },'Google Drive copy');
  if (!copy.id || copy.id===spreadsheetId || copy.mimeType!==MIME || copy.name!==name || copy.trashed)
    throw Error('Drive copy response did not confirm backup');
  const verified=await api(base+encodeURIComponent(copy.id)+
    '?fields=id,name,mimeType,trashed',{headers},'Backup verification');
  if (verified.id!==copy.id || verified.name!==name || verified.mimeType!==MIME || verified.trashed)
    throw Error('Backup verification failed');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    await backupNewGasSheet({spreadsheetId:process.env.GAS_SPREADSHEET_ID_NEW});
    console.log('Pre-deploy Google Sheet backup verified; GAS update allowed.');
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '- Google Sheets test workbook: private Drive backup created and verified before GAS update.\n');
  } catch (err) {
    console.error('GAS_DEPLOY_BLOCKED:',err.message);
    process.exitCode=1;
  }
}
