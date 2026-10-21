const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);
assert.ok(scripts.length, 'No inline scripts found');
scripts.forEach((source,index)=>{
  try{
    new Function(source);
  }catch(error){
    error.message = `Inline script ${index + 1}: ${error.message}`;
    throw error;
  }
});
console.log(`inline-syntax: ${scripts.length} scripts passed`);
