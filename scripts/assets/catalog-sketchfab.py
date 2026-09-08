"""Catalogue the user-requested public searches; never extract viewer assets."""
import json, urllib.request, urllib.parse, datetime, pathlib, time, re
OUT=pathlib.Path(__file__).resolve().parents[2]/'assets/source/sketchfab'
OUT.mkdir(parents=True,exist_ok=True)
all_models={}; queries=[]
for query in ['one piece ships','one piece']:
 url='https://api.sketchfab.com/v3/search?'+urllib.parse.urlencode({'type':'models','downloadable':'true','q':query,'count':100})
 seen=set(); pages=0; errors=[]; count=0
 while url and url not in seen:
  seen.add(url)
  try:
   with urllib.request.urlopen(url,timeout=30) as response: data=json.load(response)
  except Exception as e:
   errors.append(str(e));break
  pages+=1
  for m in data.get('results',[]):
   uid=m['uid']; count+=1
   if uid not in all_models:
    name=m['name']; text=(name+' '+m.get('description','')+' '+' '.join(t['name'] for t in m.get('tags',[]))).lower()
    relevant=bool(re.search(r'going.?merry|thousand.?sunny|polar.?tang|moby.?dick|oro.?jackson|red.?force|baratie|one.?piece.?ship|marine.?ship|queen.?mama|pirate.?ship|sailing.?ship|bezan.?black|miss.?love.?duck|saber of xebec|bikini.?bottom|ship.*one.?piece',text))
    crew=bool(re.search(r'luffy|zoro|sanji|usopp|nami|nico robin|chopper|franky|brook|jinbe|whitebeard|shanks|gol.?d.?roger|trafalgar|one.?piece.?marine',name.lower()))
    all_models[uid]={'uid':uid,'name':name,'author':m['user']['displayName'],'authorUrl':m['user']['profileUrl'],'source':m['viewerUrl'],'license':m.get('license'),'sourceFaces':m.get('faceCount'),'sourceVertices':m.get('vertexCount'),'isDownloadable':m.get('isDownloadable'), 'queries':[],'category':'vehicle-candidate' if relevant else 'crew-candidate' if crew else 'excluded-unrelated-search-result','status':'authentication-required' if relevant or crew else 'excluded','downloadedBytes':0,'runtimeMapping':None,'notes':'Official download endpoint requires authenticated access; no model bytes acquired.' if relevant or crew else 'Broad search result is not a relevant ship or principal crew candidate.'}
   all_models[uid]['queries'].append(query)
  url=data.get('next')
  time.sleep(.12)
 queries.append({'query':query,'pages':pages,'results':count,'complete':url is None,'errors':errors,'next':url})
manifest={'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'queries':queries,'officialApi':'https://api.sketchfab.com/v3/search','downloadAccess':'401 Authentication credentials were not provided.','models':list(all_models.values())}
(OUT/'catalog.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'queries':queries,'unique':len(all_models),'vehicles':sum(m['category']=='vehicle-candidate' for m in all_models.values()),'crew':sum(m['category']=='crew-candidate' for m in all_models.values())},indent=2))
print('\n'.join(m['uid']+' '+m['name'] for m in all_models.values() if m['category']=='vehicle-candidate'))
