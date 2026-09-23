"""Optimize the reviewed Blender exports and record runtime provenance. No credentials needed."""
import argparse, hashlib, html, json, pathlib, struct, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('kinds',nargs='*')
parser.add_argument('--manifest-only',action='store_true')
args=parser.parse_args()
jobs=json.loads((ROOT/'scripts/assets/sketchfab-runtime.json').read_text())
catalog={m['uid']:m for m in json.loads((ROOT/'assets/source/sketchfab/catalog.json').read_text())['models']}
metadata_path=ROOT/'scripts/assets/sketchfab-source-metadata.json'
verified={m['uid']:m for m in json.loads(metadata_path.read_text())} if metadata_path.exists() else {}
out=ROOT/'public/assets/sketchfab'
out.mkdir(parents=True,exist_ok=True)

for job in jobs:
    if args.manifest_only:continue
    if args.kinds and job['kind'] not in args.kinds:continue
    high=out/(job['kind']+'.glb')
    for detail in ['high','low']:
        source=ROOT/'assets/source/sketchfab'/job['uid']/'normalized.glb' if detail=='high' else high
        target=high if detail=='high' else out/(job['kind']+'-low.glb')
        subprocess.run(['npx','--yes','@gltf-transform/cli@4.5.0','optimize',str(source),str(target),
            '--compress','meshopt','--texture-compress','webp','--texture-size','2048' if detail=='high' else '1024',
            '--simplify-ratio',str(job['ratio']) if detail=='high' else '.12',
            '--simplify-error','.0005' if detail=='high' else '.015','--palette','true','--instance','false'],check=True)

records=[]
for job in jobs:
    original=catalog[job['uid']]
    metadata=verified.get(job['uid'],{})
    author=original['author']
    author_name=author['name'] if isinstance(author,dict) else author
    author_url=author.get('url') if isinstance(author,dict) else original.get('authorUrl')
    variants=[]
    for detail,suffix in [('high',''),('low','-low')]:
        path=out/(job['kind']+suffix+'.glb')
        if not path.exists():continue
        data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0];gltf=json.loads(data[20:20+length])
        variants.append({'detail':detail,'url':'/assets/sketchfab/'+path.name,'bytes':len(data),
            'sha256':hashlib.sha256(data).hexdigest(),
            'triangles':sum(gltf['accessors'][p['indices']]['count']//3 for m in gltf['meshes'] for p in m['primitives']),
            'draws':sum(len(m['primitives']) for m in gltf['meshes'])})
    records.append({'kind':job['kind'],'uid':job['uid'],'title':original['name'],'author':metadata.get('author',author_name),
        'authorUrl':author_url,'source':metadata.get('source',original.get('source',original.get('sourceUrl'))),'license':metadata.get('license',original['license']),
        'sourceSha256':original['sha256'],'changes':'Uniform scale, rotation and waterline translation; preserved source meshes and UVs; material styling, mesh simplification, WebP textures and Meshopt compression.',
        'normalization':job,'variants':variants})
crew=[]
for job in json.loads((ROOT/'scripts/assets/sketchfab-crew.json').read_text()):
    original=catalog[job['uid']]
    path=out/'crew'/(job['id']+'.glb')
    data=path.read_bytes()
    license=next((m['license'] for m in verified.values() if m['license'].get('uri','').endswith(original['license'].get('uid','__missing'))),original['license'])
    if 'url' not in license:raise ValueError('Missing verified license URL for '+job['uid'])
    crew.append({**job,'source':original.get('source',original.get('sourceUrl')),
        'authorUrl':original.get('authorUrl'),'license':license,
        'sourceSha256':original['sha256'],'url':'/assets/sketchfab/crew/'+path.name,
        'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
        'changes':'Meshopt compression, WebP texture optimization, retained source skeleton and available animation clips; runtime uniform scale and materials.'})
(out/'manifest.json').write_text(json.dumps({'ships':records,'crew':crew},indent=2)+'\n')
escape=lambda value:html.escape(str(value),quote=True)
articles=[]
for record in records+crew:
    license=record['license']
    articles.append(f'<article><h2>{escape(record["title"])}</h2><p>By {escape(record["author"])}</p>'
        f'<p><a href="{escape(record["source"])}">Original Sketchfab model</a> · '
        f'<a href="{escape(license["url"].replace("http:","https:"))}">{escape(license["label"])}</a></p>'
        f'<p>{escape(record["changes"])}</p></article>')
(ROOT/'public/credits.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Artist credits · We Are on the Cruise</title><style>body{margin:0;background:#102637;color:#fff0d4;font:17px/1.6 system-ui}main{max-width:850px;margin:auto;padding:48px 24px}h1{font-size:42px;line-height:1.15}h2{font-size:23px}a{color:#ffcf68}article{padding:20px 0;border-top:1px solid #ffffff30}p{margin:8px 0}.note{color:#b9d3dc}</style><main><a href="/">← Back to the harbor</a><h1>The artists behind the fleet</h1><p>The ships and crew are adapted from these downloaded models. Thank you to their creators.</p>'''
    +'\n'.join(articles)+'''<p>The adapted Moby Dick GLBs are available under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>: <a href="/assets/sketchfab/moby-dick.glb">high detail</a>, <a href="/assets/sketchfab/moby-dick-low.glb">low detail</a>. Other adapted models retain the attribution licenses above.</p><p class="note">Unofficial fan project. One Piece names and characters belong to their respective owners. These asset licenses describe the creators' uploads.</p><p><a href="/assets/sketchfab/manifest.json">Source and runtime asset manifest</a></p></main></html>''')
