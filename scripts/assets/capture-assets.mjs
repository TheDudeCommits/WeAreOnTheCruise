import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out='output/asset-gauntlet';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors=[];const assets=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 page.on('response',r=>{if(r.url().endsWith('.glb'))assets.push({url:r.url(),status:r.status()});});
 await page.goto('http://localhost:4180/?capture=1&seed=asset-gauntlet&scene=crew-closeup',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__CRUISE_DEBUG__?.ready,{timeout:60000});
 for(const kind of ['thousand-sunny','navy-galleon']) {
  await page.evaluate(kind=>{const d=window.__CRUISE_DEBUG__;d.selectShip(kind);d.setCamera('cinematic');d.step(4);},kind);
  await page.waitForLoadState('networkidle');
  await page.evaluate(()=>window.__CRUISE_DEBUG__.step(1));
  await page.screenshot({path:`${out}/${kind}-cinematic.png`});
  await page.evaluate(()=>{const d=window.__CRUISE_DEBUG__;d.setCamera('deck');d.step(2);});
  await page.screenshot({path:`${out}/${kind}-crew.png`});
 }
 await writeFile(`${out}/receipt.json`,JSON.stringify({errors,assets,metrics:await page.evaluate(()=>window.__CRUISE_DEBUG__.getMetrics())},null,2));
} finally {await browser.close();}
console.log(JSON.stringify({errors,assets}));
