import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../scripts/verify-production-gas-remote.mjs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/production-gas-readonly-audit.yml',import.meta.url),'utf8');
new vm.SourceTextModule(script,{identifier:'verify-production-gas-remote.mjs'});
assert.match(workflow,/workflow_dispatch:/);
assert.match(workflow,/production_gas_script_id:/);
assert.match(workflow,/permissions:\s*\n\s*contents: read/);
assert.match(workflow,/clasp@3 pull/);
assert.match(workflow,/clasp@3 list-deployments/);
assert.match(workflow,/verify-production-gas-remote.mjs/);
assert.doesNotMatch(workflow,/clasp@3\s+(?:push|deploy|update-deployment|create-deployment)/);
assert.doesNotMatch(workflow,/SpreadsheetApp\.create|setProperty|setValues|rm\s+-rf/);
assert.doesNotMatch(script,/SpreadsheetApp\.|DriveApp\.|PropertiesService\.|\.setValues\s*\(|\.deleteSheet\s*\(/);
assert.ok(script.includes('REMOTE_CODE_NOT_MATCHING_REVIEWED_MAIN_HISTORY'));
assert.ok(script.includes('PRODUCTION_SCRIPT_DOES_NOT_OWN_PUBLISHED_DEPLOYMENT'));
console.log('Production GAS remote audit is owner-triggered, GitHub read-only and no write API is called');
