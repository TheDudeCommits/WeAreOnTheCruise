import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve(process.env.CRUISE_PROGRESSION_DIR??'output/overhaul-gauntlet/progression');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false});const receipt={method:'Real UI decisions and normal helm actions with accelerated deterministic simulation stepping; no state fabrication. Not a performance sample.',runs:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>receipt.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')receipt.errors.push(m.text());});
 const shot=async(n)=>{await page.waitForTimeout(350);await page.screenshot({path:resolve(out,n+'.png')});};
 await page.goto((process.env.CRUISE_URL??'http://127.0.0.1:4173')+'/?seed=progression-gauntlet',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__CRUISE_DEBUG__?.ready);await page.locator('[data-action="launch"]').click();
 for(let run=1;run<=2;run++){
  await page.locator('[data-contract="lost-cargo"]').click();await page.locator('[data-build="interceptor"]').click();await page.locator('[data-voyage="start"]').click();await page.locator('[data-route="leg-1-sheltered"]').click();await page.locator('.voyage-panel').waitFor({state:'hidden'});
  const navigation=await page.evaluate(async()=>{
   const d=window.__CRUISE_DEBUG__;let samples=[];
   for(let i=0;i<900;i++){
    const s=d.getState(),p=s.ships.find(x=>x.id===s.playerId),e=s.voyage.encounter;
    if(e.completed){for(const a of ['steer-left','steer-right','throttle-up','throttle-down'])d.action(a,false);return {complete:true,elapsed:s.elapsed,progress:e.progress,target:e.target,position:p.position,waypoint:e.waypoint,samples};}
    const dx=e.waypoint.x-p.position.x,dz=e.waypoint.z-p.position.z,dist=Math.hypot(dx,dz);const wanted=Math.atan2(-dx,-dz),err=Math.atan2(Math.sin(wanted-p.heading),Math.cos(wanted-p.heading));
    d.action('steer-left',err>.045);d.action('steer-right',err<-.045);
    d.action('throttle-up',dist>100);d.action('throttle-down',dist<100);
    d.step(30);if(i%30===0)samples.push({elapsed:s.elapsed,dist,speed:p.speed,heading:p.heading,err,progress:e.progress});await new Promise(requestAnimationFrame);
   }
   return {complete:false,state:d.getState(),samples};
  });
  receipt.runs.push(navigation);if(!navigation.complete)throw new Error('Normal helm navigation did not secure cargo');
  await shot(`run-${run}-secured`);await page.locator('[data-action="collect"]').click();await page.locator('[data-reward]').first().waitFor({state:'visible'});await shot(`run-${run}-earned-rewards`);
  const pre=await page.evaluate(()=>window.__CRUISE_DEBUG__.getState());await page.locator('[data-reward="supplies"]').count()?await page.locator('[data-reward="supplies"]').click():await page.locator('[data-reward]').first().click();
  await page.locator('[data-voyage="extract"]').click();await page.locator('[data-voyage="harbor"]').waitFor({state:'visible'});await shot(`run-${run}-extracted`);
  const post=await page.evaluate(()=>window.__CRUISE_DEBUG__.getState());receipt.runs.at(-1).payout={before:pre.progression.bankedCoins,unbanked:pre.voyage.unbankedCoins,after:post.progression.bankedCoins,result:post.voyage.result};
  if(post.voyage.result.outcome!=='extracted'||post.progression.bankedCoins!==pre.progression.bankedCoins+pre.voyage.unbankedCoins)throw new Error('Extraction payout mismatch');
  await page.locator('[data-voyage="harbor"]').click();
 }
 await page.locator('.refit-list summary').click();await shot('refit-available');await page.locator('[data-refit="rangefinder"]').click();await shot('refit-purchased');
 receipt.final=await page.evaluate(()=>window.__CRUISE_DEBUG__.getState());if(receipt.final.progression.refits.rangefinder!==1)throw new Error('Refit was not purchased');
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__CRUISE_DEBUG__?.ready);receipt.restored=await page.evaluate(()=>window.__CRUISE_DEBUG__.getState());if(receipt.restored.progression.refits.rangefinder!==1||receipt.restored.progression.bankedCoins!==receipt.final.progression.bankedCoins)throw new Error('Refit/bank restore mismatch');
 await shot('refit-restored');receipt.scripts=await page.evaluate(()=>[...document.scripts].map(s=>s.src));
}catch(e){receipt.errors.push(String(e));process.exitCode=1;}finally{await browser.close();await writeFile(resolve(out,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({runs:receipt.runs.map(r=>({complete:r.complete,elapsed:r.elapsed,payout:r.payout})),errors:receipt.errors}));}
