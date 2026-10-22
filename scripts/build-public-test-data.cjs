// Build boundary only: never change source data, protocols or application saving logic.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function buildPublicTestData(out){
 const scope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'revize-machine-db.js'),'utf8'),scope);
 const fields=['model','maker','year','group','typeGroup','deviceType','workHeight','floorHeight','reach','capacity','weight','drive','power','tilt','staticLoad','dynamicLoad','norma','normyRevize','charger','socket','rcd','workingEnvelopes','outdoorReach','outdoorCapacity','outdoorCapacityPersons','outdoorWind','outdoorWorkHeight','outdoorFloorHeight','limitVariantKind'];
 const serialIds=new Map(),rows=scope.window.REVIZE_MACHINE_DB.map(record=>{
   const original=String(record.serial||'').trim().toLowerCase();if(!serialIds.has(original))serialIds.set(original,'REF-'+String(serialIds.size+1).padStart(4,'0'));
   const result={serial:serialIds.get(original),referenceOnly:true,source:'Existující technická evidence — anonymizovaná reference pro veřejný TEST'};
   for(const field of fields)if(record[field]!==undefined)result[field]=record[field];return result;
 });
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'revize-machine-db.js'),'// Public TEST: factual technical references only; REF identifiers are not actual serial numbers.\nwindow.LIFTCONTROL_PUBLIC_REFERENCE_DATA=true;\nwindow.REVIZE_MACHINE_DB='+JSON.stringify(rows)+';\n');
 const collections=Object.fromEntries(['protokoly_test','protokoly','plan_prace','planPrace','nahradni_dily','nahradniDily','hlaseni_poruch','hlaseniPoruch','historie_zmen','historieZmen'].map(key=>[key,[]]));
 fs.writeFileSync(path.join(out,'liftcontrol-backup-data.js'),'// Public TEST deliberately ships no actual protocols, photos, employee or customer records.\nwindow.LIFTCONTROL_EMBEDDED_BACKUP='+JSON.stringify({publicTest:true,collections})+';\n');
 return {references:rows.length,identities:serialIds.size,operationalRecords:0};
}
module.exports={buildPublicTestData};
if(require.main===module){const target=process.argv[2];if(!target)throw Error('Explicit output folder required');console.log(JSON.stringify(buildPublicTestData(path.resolve(target))))}
