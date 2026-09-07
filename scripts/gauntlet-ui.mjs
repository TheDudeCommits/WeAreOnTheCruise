import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.CRUISE_UI_DIR??'output/overhaul-gauntlet/ui-02');
const base=process.env.CRUISE_URL??'http://127.0.0.1:4173';await mkdir(output,{recursive:true});
const sizes={desktop:{width:1600,height:900},portrait:{width:390,height:844},landscape:{width:844,height:390}};
const requestedViewports=process.env.CRUISE_UI_VIEWPORTS?.split(',').map(name=>name.trim());
if(requestedViewports?.some(name=>!Object.hasOwn(sizes,name)))throw new Error('Unknown CRUISE_UI_VIEWPORTS value');
const browser=await chromium.launch({headless:false});const results=[];
try{for(const [name,viewport] of Object.entries(sizes).filter(([name])=>!requestedViewports||requestedViewports.includes(name))){
 const context=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:name!=='desktop'});const page=await context.newPage();const errors=[];const checks=[];
 await page.addInitScript(()=>{window.__UI_BOOT_SAVE__=localStorage.getItem('cruise.voyage.v1');});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const check=(title,pass,detail)=>{checks.push({title,pass,detail});if(!pass)throw new Error(title+': '+JSON.stringify(detail));};
 const snapshot=async(label)=>{await page.waitForTimeout(350);await page.screenshot({path:resolve(output,`${name}-${label}.png`)});};
 try{
  await page.goto(base+'/?seed=ui-gauntlet-A',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__CRUISE_DEBUG__?.ready);
  await snapshot('embark');const cards=await page.locator('[data-ship]').count();check('All nine ship choices shown',cards===9,cards);
  const kinds=await page.locator('[data-ship]').evaluateAll(es=>es.map(e=>e.dataset.ship));
  for(const kind of kinds){await page.locator(`[data-ship="${kind}"]`).click();await page.waitForFunction(kind=>window.__CRUISE_DEBUG__.getState().ships.find(s=>s.id==='player')?.kind===kind,kind);}
  await page.locator('[data-ship="thousand-sunny"]').click();
  if(name==='desktop'){
   await page.locator('[data-ship="going-merry"]').focus();await page.keyboard.press('Enter');
   check('Enter selects focused ship without launching',await page.locator('[data-ui="intro"]').isVisible()&&(await page.evaluate(()=>window.__CRUISE_DEBUG__.getState().ships.find(s=>s.id==='player').kind))==='going-merry');
   await page.locator('[data-ship="thousand-sunny"]').click();
  }
  await page.locator('[data-action="launch"]').click();await page.locator('.voyage-panel').waitFor({state:'visible'});await snapshot('contracts');
  await page.locator('[data-contract="lost-cargo"]').click();
  if(name==='desktop')check('Contract button keeps keyboard focus',await page.locator('[data-contract="lost-cargo"]').evaluate(e=>e===document.activeElement));
  for(const build of ['precision','guardian','interceptor'])await page.locator(`[data-build="${build}"]`).click();
  await page.locator('[data-voyage="start"]').click();await page.locator('[data-route]').first().waitFor({state:'visible'});await snapshot('routes');
  await page.locator('[data-route="leg-1-sheltered"]').click();await page.locator('.voyage-panel').waitFor({state:'hidden'});
  await page.waitForTimeout(500);check('Route enters active simulation',await page.evaluate(()=>{const s=window.__CRUISE_DEBUG__.getState();return s.voyage.phase==='encounter'&&!s.paused;}));
  await page.locator('[data-action="crew-cycle"]').click();await page.locator('#crew-orders-popover').waitFor({state:'visible'});await snapshot('crew-orders');
  const frozen=await page.evaluate(()=>window.__CRUISE_DEBUG__.getState().elapsed);await page.waitForTimeout(350);check('Crew menu pauses safely',Math.abs((await page.evaluate(()=>window.__CRUISE_DEBUG__.getState().elapsed))-frozen)<.001);
  await page.locator('[data-quick-crew="gunnery"]').click();await page.locator('#crew-orders-popover').waitFor({state:'hidden'});check('Direct crew order applies',await page.evaluate(()=>window.__CRUISE_DEBUG__.getState().ships.find(s=>s.id==='player').crewPreset==='gunnery'));
  if(name==='desktop')await page.keyboard.press('Escape');else await page.locator('[data-action="menu"]').click();
  await page.waitForTimeout(400);await snapshot('pause');const paused=await page.evaluate(()=>window.__CRUISE_DEBUG__.getState().elapsed);await page.waitForTimeout(350);check('Pause freezes simulation',Math.abs((await page.evaluate(()=>window.__CRUISE_DEBUG__.getState().elapsed))-paused)<.001);
  await page.getByText('CONTROLS & COMFORT',{exact:true}).click();await snapshot('settings');
  if(name==='desktop'){
   await page.locator('[data-remap="cycle-ammo"]').click();await page.keyboard.press('b');
   check('Remap saves on device',await page.evaluate(()=>JSON.parse(localStorage.getItem('cruise.controls.v1')).keyBindings.KeyB==='cycle-ammo'));
  }
  await page.locator('[data-action="resume"]').click();await page.waitForTimeout(350);await snapshot('helm');
  const stateBefore=await page.evaluate(()=>window.__CRUISE_DEBUG__.getState());
  const diagnostics=async()=>page.evaluate(()=>({state:window.__CRUISE_DEBUG__.getState(),exportSave:window.__CRUISE_DEBUG__.exportSave(),rawLocalStorage:localStorage.getItem('cruise.voyage.v1'),bootRawLocalStorage:window.__UI_BOOT_SAVE__,saveStatus:document.querySelector('#app')?.dataset.save,scripts:[...document.scripts].map(s=>s.src)}));
  if(process.env.CRUISE_UI_NEGATIVE_RELOAD==='1'){
   const navigation=page.waitForEvent('framenavigated',{predicate:frame=>frame===page.mainFrame(),timeout:35000});
   await page.evaluate(()=>{
    const poll=()=>{
     const exported=window.__CRUISE_DEBUG__.exportSave();
     if(exported.accumulator<0){sessionStorage.setItem('cruise.ui.negative-probe',JSON.stringify({stateBefore:window.__CRUISE_DEBUG__.getState(),exportSave:exported,rawLocalStorage:localStorage.getItem('cruise.voyage.v1')}));location.reload();}
     else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
   });
   await navigation;await page.waitForLoadState('domcontentloaded');
   const raw=await page.evaluate(()=>sessionStorage.getItem('cruise.ui.negative-probe'));
   await writeFile(resolve(output,`${name}-before-reload.json`),raw);
  }else{
   await page.waitForTimeout(2100);
   await writeFile(resolve(output,`${name}-before-reload.json`),JSON.stringify({stateBefore,...await diagnostics()},null,2));
   await page.reload({waitUntil:'domcontentloaded'});
  }
  await page.waitForFunction(()=>window.__CRUISE_DEBUG__?.ready);await snapshot('restored');
  const after=await diagnostics();await writeFile(resolve(output,`${name}-after-reload.json`),JSON.stringify(after,null,2));
  const restored=after.state;check('Full voyage restores after reload',restored.voyage.id===stateBefore.voyage.id&&restored.voyage.phase==='encounter'&&restored.ships.find(s=>s.id==='player').crewPreset==='gunnery',{before:{id:stateBefore.voyage.id,phase:stateBefore.voyage.phase,crew:stateBefore.ships.find(s=>s.id==='player').crewPreset,elapsed:stateBefore.elapsed},after:{id:restored.voyage.id,phase:restored.voyage.phase,crew:restored.ships.find(s=>s.id==='player').crewPreset,elapsed:restored.elapsed},bootSavePresent:Boolean(after.bootRawLocalStorage)});
  check('No JavaScript or shader errors',errors.length===0,errors);
  const layout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,scripts:[...document.scripts].map(s=>s.src)}));check('No page-wide horizontal overflow',layout.scrollWidth<=viewport.width,layout);
 }catch(e){errors.push(String(e));await snapshot('failure').catch(()=>{});process.exitCode=1;}finally{results.push({name,viewport,checks,errors});await context.close();await writeFile(resolve(output,'receipt.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));}
}}finally{await browser.close();}
