/** Real UI load failure/retry and out-of-order selection checks. No replacement assets. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.CRUISE_URL??'http://127.0.0.1:4199';
const output=process.env.CRUISE_ASSET_QA_DIR??'output/asset-gauntlet/loading';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:false});
const checks=[],pageErrors=[],expectedNetworkErrors=[];
const check=(name,pass,detail)=>{checks.push({name,pass:Boolean(pass),detail});if(!pass)throw Error(name);};
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')expectedNetworkErrors.push(message.text());});
 await page.goto(base+'/?scene=crew-closeup&seed=asset-loading',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__CRUISE_DEBUG__?.ready);
 const player=()=>page.evaluate(()=>{const s=window.__CRUISE_DEBUG__.getState();return s.ships.find(ship=>ship.id===s.playerId).kind;});
 await page.route('**/assets/sketchfab/moby-dick.glb',route=>route.fulfill({status:503,body:'Deliberate asset-loading QA failure'}));
 await page.locator('[data-ship="moby-dick"]').click();
 await page.getByText(/Moby Dick could not load/).waitFor();
 check('A failed model keeps launch disabled',await page.locator('[data-action="launch"]').isDisabled());
 check('A failed model does not replace the existing vessel',await player()==='thousand-sunny',await player());
 await page.unroute('**/assets/sketchfab/moby-dick.glb');
 await page.locator('[data-ship="going-merry"]').click();
 await page.waitForFunction(()=>window.__CRUISE_DEBUG__.getState().ships.find(s=>s.isPlayer)?.kind==='going-merry');
 await page.locator('[data-ship="moby-dick"]').click();
 await page.waitForFunction(()=>window.__CRUISE_DEBUG__.getState().ships.find(s=>s.isPlayer)?.kind==='moby-dick');
 await page.evaluate(()=>window.__CRUISE_DEBUG__.readyAssets());
 check('Failed download retries successfully without a reload',await page.locator('[data-action="launch"]').isEnabled());
 let release,started;
 const gate=new Promise(resolve=>release=resolve), requestStarted=new Promise(resolve=>started=resolve);
 await page.route('**/assets/sketchfab/navy-galleon.glb',async route=>{started();await gate;await route.continue();});
 await page.locator('[data-ship="navy-galleon"]').click();
 await requestStarted;
 await page.locator('[data-ship="going-merry"]').click();
 await page.waitForFunction(()=>window.__CRUISE_DEBUG__.getState().ships.find(s=>s.isPlayer)?.kind==='going-merry');
 release();await page.evaluate(()=>window.__CRUISE_DEBUG__.readyAssets());
 await page.waitForTimeout(500);
 check('A slower previous selection cannot replace the latest selected ship',await player()==='going-merry',await player());
 check('Latest selected ship remains launchable',await page.locator('[data-action="launch"]').isEnabled());
 const assets=await page.evaluate(()=>window.__CRUISE_DEBUG__.getAssets());
 check('Every visible model identifies an actual ready Sketchfab source',assets.every(a=>a.source==='sketchfab'&&a.status==='ready'&&a.meshes>0),assets);
 check('No unhandled JavaScript errors',pageErrors.length===0,pageErrors);
 check('Only the deliberate HTTP error was logged',expectedNetworkErrors.length===1&&expectedNetworkErrors[0].includes('503'),expectedNetworkErrors);
 await page.screenshot({path:output+'/retry-and-latest-selection.png'});
} finally {
 await browser.close();
 await writeFile(output+'/receipt.json',JSON.stringify({checks,pageErrors,expectedNetworkErrors},null,2));
}
console.log(JSON.stringify({checks:checks.length,passed:checks.every(c=>c.pass),pageErrors}));
