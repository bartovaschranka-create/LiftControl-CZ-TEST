const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const baseline=execFileSync('git',['show','origin/main:index.html'],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
const current=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n');
const additions=['<link rel="stylesheet" href="./assets/machine-passport.css">\n','<script src="./assets/machine-passport.js"></script>\n','    <section id="machinePassport" aria-label="Orientační pasport stroje"></section>\n','  renderMachinePassport(serial,rows);\n'];
let stripped=current;
for(const line of additions){assert.equal(stripped.split(line).length,2,'Expected one presentation insertion');stripped=stripped.replace(line,'');}
assert.equal(stripped,baseline,'Existing app, storage, RZ form and print source must remain exactly unchanged');
console.log('unchanged-app: removing four presentation insertions restores origin/main byte-for-byte after line-ending normalization; all storage and RZ source unchanged');
