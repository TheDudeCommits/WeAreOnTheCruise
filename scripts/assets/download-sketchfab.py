"""Download requested catalog vehicles, plus optional tagged crew, through Sketchfab's official auth API.
Configure SKETCHFAB_API_TOKEN locally; this script never prints credentials or signed URLs.
Run again to resume. Source archives stay outside public/ until inspected and optimized.
"""
import os,json,pathlib,urllib.request,urllib.error,hashlib,datetime,argparse,collections
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--include-crew',action='store_true',help='Also select the existing crew-candidate catalog records; unrelated search results stay excluded.')
parser.add_argument('--dry-run',action='store_true',help='Report candidate counts without credentials, network requests or filesystem changes.')
args=parser.parse_args()
ROOT=pathlib.Path(__file__).resolve().parents[2]
manifest_path=ROOT/'assets/source/sketchfab/catalog.json'
manifest=json.loads(manifest_path.read_text())
categories={'vehicle-candidate','ship-component-candidate'}
if args.include_crew:categories.add('crew-candidate')
selected_models=[model for model in manifest['models'] if model['category'] in categories]
if args.dry_run:
 print(json.dumps({'dryRun':True,'selectedCategories':sorted(categories),'selectedModels':len(selected_models),'categoryCounts':dict(sorted(collections.Counter(model['category'] for model in selected_models).items())),'archiveDirectory':'assets/source/sketchfab','publishesRuntimeAssets':False},indent=2))
 raise SystemExit(0)
token=os.environ.get('SKETCHFAB_API_TOKEN')
if not token:raise SystemExit('Set SKETCHFAB_API_TOKEN in your local environment to authorize official downloads. No token was found.')
for model in selected_models:
 uid=model['uid'];folder=ROOT/'assets/source/sketchfab'/uid;folder.mkdir(exist_ok=True)
 if model['status']=='downloaded' and any(folder.glob('source.*')):continue
 try:
  req=urllib.request.Request('https://api.sketchfab.com/v3/models/'+uid+'/download',headers={'Authorization':'Token '+token})
  with urllib.request.urlopen(req,timeout=30) as r:links=json.load(r)
  selected=next(((key,links[key]) for key in ['glb','gltf','source'] if key in links),None)
  if not selected:model['status']='no-download-format';continue
  fmt,data=selected;destination=folder/('source.glb' if fmt=='glb' else 'source.zip')
  # Signed provider URLs are used only in memory and never persisted in the manifest.
  with urllib.request.urlopen(data['url'],timeout=120) as r,destination.open('wb') as output:
   while True:
    chunk=r.read(1024*1024)
    if not chunk:break
    output.write(chunk)
  model.update(status='downloaded',downloadedBytes=destination.stat().st_size,downloadFormat=fmt,archive=str(destination.relative_to(ROOT)),sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),downloadedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),notes='Official provider archive downloaded; geometry inspection, stylization and runtime mapping pending.')
  print('Downloaded',uid,model['name'],model['downloadedBytes'],'bytes')
 except urllib.error.HTTPError as e:
  model.update(status='authentication-required' if e.code in [401,403] else 'download-error',notes='Official download HTTP '+str(e.code))
  print('Download unavailable',uid,'HTTP',e.code)
 finally:manifest_path.write_text(json.dumps(manifest,indent=2))
