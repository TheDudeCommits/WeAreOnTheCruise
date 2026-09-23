import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.CRUISE_CAPTURE_DIR??'output/overhaul-gauntlet/pass-01');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:false});
try {
 for(const label of process.argv.slice(2).length?process.argv.slice(2):['calm-sailing','island-discovery','sunny-broadside','damaged-ship','crew-closeup']){
  const scene=label==='crew-repairs'?'damaged-ship':label==='hero-ship'?'crew-closeup':label;
  const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});const errors=[];page.setDefaultTimeout(30000);
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(`${process.env.CRUISE_URL??'http://localhost:4173'}/?capture=1&seed=gauntlet-A&scene=${scene}`,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>window.__CRUISE_DEBUG__?.ready,{timeout:45000});
   const camera=label==='hero-ship'?'cinematic':label==='crew-repairs'||scene==='crew-closeup'?'deck':scene==='sunny-broadside'?'broadside':scene==='damaged-ship'?'cinematic':'chase';
   await page.evaluate(async({scene,camera,label})=>{const d=window.__CRUISE_DEBUG__;await d.setScene(scene);d.setCamera(camera);if(label==='crew-repairs'){await d.voyage('crew','repair');d.action('repair',true);}for(let i=0;i<24;i++){d.step(label==='crew-repairs'?5:1);await new Promise(requestAnimationFrame);}d.setPaused(true);}, {scene,camera,label});
   console.log(JSON.stringify({scene,errors,beforeScreenshot:await page.evaluate(()=>window.__CRUISE_DEBUG__.getMetrics())}));
   await page.screenshot({path:resolve(output,label+'.png'),timeout:60000});
   const receipt=await page.evaluate(()=>({state:window.__CRUISE_DEBUG__.getState(),metrics:window.__CRUISE_DEBUG__.getMetrics(),loadedScripts:[...document.scripts].map(s=>s.src),capturedAt:new Date().toISOString()}));
   await writeFile(resolve(output,label+'.json'),JSON.stringify({...receipt,errors},null,2));console.log(JSON.stringify({scene,errors,metrics:receipt.metrics})); if(errors.length)process.exitCode=1;
  }finally{await page.close();}
 }
}finally{await browser.close();}
