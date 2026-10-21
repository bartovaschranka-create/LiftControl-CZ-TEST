const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
// Fixed pre-redesign baseline: origin/main moves after merges and cannot be the regression oracle.
const baseline=execFileSync('git',['show','a4f7fbf2d8fd2e324eeeb23281e03795ce439da7:index.html'],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
const current=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n');
const additions=['<link rel="stylesheet" href="./assets/machine-passport.css">\n','<script src="./assets/machine-passport.js"></script>\n','    <section id="machinePassport" aria-label="Orientační pasport stroje"></section>\n','  renderMachinePassport(serial,rows);\n'];
additions.push('<script src="./assets/dispatch-ui.js" defer></script>\n');
additions.push('<script src="./assets/workspace-ui.js" defer></script>\n','<link rel="stylesheet" href="./assets/workspace-ui.css">\n');
let stripped=current;
for(const line of additions){assert.equal(stripped.split(line).length,2,'Expected one presentation insertion');stripped=stripped.replace(line,'');}
assert.equal(stripped,baseline,'Existing app, storage, RZ form and print source must remain exactly unchanged');
console.log('unchanged-app: presentation insertions removed; original storage, forms, suggestions and RZ source match fixed pre-redesign baseline');
