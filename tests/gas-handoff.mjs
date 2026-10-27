import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../gas-setup.html',import.meta.url),'utf8');
const gas=readFileSync(new URL('../gas/Code.gs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/pages-previews.yml',import.meta.url),'utf8');
assert.match(html,/id="copy"/);
assert.match(html,/navigator\.clipboard\.writeText\(source\.value\)/);
assert.match(html,/fetch\('\.\/gas\/Code\.gs'/);
assert.match(html,/initializeEmptySchema_\(\)/);
assert.match(html,/バックアップ/);
assert.match(gas,/function testAllSheetsReadOnly\(\)/);
// Verify actual file membership, not an obsolete adjacency/order assumption.
const fileDeclaration=workflow.match(/^\s*files=\(([^\n)]*)\)/m);
assert.ok(fileDeclaration,'Preview file list is declared');
const packagedFiles=new Set(fileDeclaration[1].trim().split(/\s+/));
for(const requiredFile of ['gas-setup.html','gas-trial-setup.html','gas/Code.gs'])
 assert.ok(packagedFiles.has(requiredFile),'Preview must package '+requiredFile);
assert.match(workflow,/git show "\$ref:\$file" > "\$dest\/\$file"/);

assert.match(workflow,/mkdir -p "\$\(dirname "\$dest\/\$file"\)"/);
console.log('iPhone GAS copy page packaging checks PASS');
