"""Download requested catalog vehicles, plus optional tagged crew, through Sketchfab's official auth API.
Configure SKETCHFAB_API_TOKEN locally; this script never prints credentials or signed URLs.
Run again to resume. Source archives stay outside public/ until inspected and optimized.
"""
import os,json,pathlib,urllib.request,urllib.error,hashlib,datetime,argparse,collections,time,concurrent.futures,threading
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--include-crew',action='store_true',help='Also select the existing crew-candidate catalog records; unrelated search results stay excluded.')
parser.add_argument('--dry-run',action='store_true',help='Report candidate counts without credentials, network requests or filesystem changes.')
parser.add_argument('--uids',nargs='+',help='Download only these selected catalog UIDs, in the supplied order.')
parser.add_argument('--workers',type=int,default=4,choices=range(1,5),help='Concurrent official downloads (1–4). Manifest updates remain serial and atomic.')
args=parser.parse_args()
ROOT=pathlib.Path(__file__).resolve().parents[2]
manifest_path=ROOT/'assets/source/sketchfab/catalog.json'
manifest=json.loads(manifest_path.read_text())
categories={'vehicle-candidate','ship-component-candidate'}
if args.include_crew:categories.add('crew-candidate')
selected_models=[model for model in manifest['models'] if model['category'] in categories]
if args.uids:
 by_uid={model['uid']:model for model in selected_models}
 missing=set(args.uids)-by_uid.keys()
 if missing:raise SystemExit('UIDs must belong to the selected catalog categories: '+', '.join(sorted(missing)))
 selected_models=[by_uid[uid] for uid in args.uids]
if args.dry_run:
 print(json.dumps({'dryRun':True,'selectedCategories':sorted(categories),'selectedModels':len(selected_models),'categoryCounts':dict(sorted(collections.Counter(model['category'] for model in selected_models).items())),'archiveDirectory':'assets/source/sketchfab','publishesRuntimeAssets':False},indent=2))
 raise SystemExit(0)
token=os.environ.get('SKETCHFAB_API_TOKEN')
if not token:raise SystemExit('Set SKETCHFAB_API_TOKEN in your local environment to authorize official downloads. No token was found.')
def digest(path):
 checksum=hashlib.sha256()
 with path.open('rb') as source:
  for chunk in iter(lambda:source.read(1024*1024),b''):checksum.update(chunk)
 return checksum.hexdigest()
def save_manifest():
 temporary=manifest_path.with_suffix('.json.tmp')
 temporary.write_text(json.dumps(manifest,indent=2))
 temporary.replace(manifest_path)
request_lock=threading.Lock()
quota_stop=threading.Event()
next_request=0.0
def rate_gate():
 global next_request
 while True:
  if quota_stop.is_set():raise InterruptedError('Provider cooldown: queue stopped')
  with request_lock:
   delay=next_request-time.monotonic()
   if delay<=0:
    next_request=time.monotonic()+3.0
    return
  time.sleep(min(delay,5))
def backoff(seconds):
 global next_request
 with request_lock:next_request=max(next_request,time.monotonic()+seconds)
def download_model(original):
 model=dict(original)
 uid=model['uid'];folder=ROOT/'assets/source/sketchfab'/uid;folder.mkdir(exist_ok=True)
 existing=ROOT/model.get('archive','missing')
 if model['status']=='downloaded' and existing.is_file() and digest(existing)==model.get('sha256'):return model
 if quota_stop.is_set():return model
 partial=folder/'source.part'
 try:
  req=urllib.request.Request('https://api.sketchfab.com/v3/models/'+uid+'/download',headers={'Authorization':'Token '+token})
  for attempt in range(3):
   try:
    rate_gate()
    with urllib.request.urlopen(req,timeout=30) as r:links=json.load(r)
    break
   except urllib.error.HTTPError as retry_error:
    if retry_error.code not in [429,500,502,503,504] or attempt==2:raise
    retry_after=retry_error.headers.get('Retry-After','60')
    delay=float(retry_after) if retry_after.isdigit() else 60.0
    backoff(max(10,min(300,delay)))
  selected=next(((key,links[key]) for key in ['glb','gltf','source'] if key in links),None)
  if not selected:model['status']='no-download-format';return model
  fmt,data=selected;destination=folder/('source.glb' if fmt=='glb' else 'source.zip')
  # Signed provider URLs are used only in memory and never persisted in the manifest.
  with urllib.request.urlopen(data['url'],timeout=120) as r,partial.open('wb') as output:
   while True:
    chunk=r.read(1024*1024)
    if not chunk:break
    output.write(chunk)
  if not partial.stat().st_size:raise ValueError('Empty archive')
  with partial.open('rb') as check:
   signature=check.read(4)
  if (fmt=='glb' and signature!=b'glTF') or (fmt!='glb' and signature[:2]!=b'PK'):raise ValueError('Unexpected archive format')
  partial.replace(destination)
  model.update(status='downloaded',downloadedBytes=destination.stat().st_size,downloadFormat=fmt,archive=str(destination.relative_to(ROOT)),sha256=digest(destination),downloadedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),notes='Official provider archive downloaded; geometry inspection, stylization and runtime mapping pending.')
  print('Downloaded',uid,model['name'],model['downloadedBytes'],'bytes')
 except urllib.error.HTTPError as e:
  if e.code==429:quota_stop.set()
  model.update(status='authentication-required' if e.code in [401,403] else 'rate-limited' if e.code==429 else 'download-error',notes='Official download HTTP '+str(e.code))
  print('Download unavailable',uid,'HTTP',e.code)
 except InterruptedError:
  return model
 except (urllib.error.URLError,OSError,TimeoutError,ValueError) as e:
  model.update(status='download-error',notes='Official download failed: '+type(e).__name__)
  print('Download unavailable',uid,type(e).__name__)
 finally:
  partial.unlink(missing_ok=True)
 return model

by_uid={model['uid']:model for model in manifest['models']}
with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
 futures=[pool.submit(download_model,model) for model in selected_models]
 for future in concurrent.futures.as_completed(futures):
  result=future.result()
  by_uid[result['uid']].update(result)
  manifest['downloadAccess']={'authenticated':True,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'downloadedModels':sum(m.get('status')=='downloaded' for m in manifest['models']),'downloadedBytes':sum(m.get('downloadedBytes',0) for m in manifest['models'])}
  if quota_stop.is_set():manifest['downloadAccess']['stoppedReason']='Persistent HTTP 429 after bounded retry: queue stopped; resume only after provider cooldown.'
  save_manifest()
