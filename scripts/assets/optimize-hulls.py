import pathlib,subprocess,json,struct,hashlib
root=pathlib.Path(__file__).resolve().parents[2]
reports=[]
for p in (root/'public/assets/ships').glob('*.glb'):
 original=root/'assets/source'/p.name
 original.write_bytes(p.read_bytes())
 subprocess.run(['npx','--yes','@gltf-transform/cli','optimize',str(original),str(p),'--compress','quantize','--palette','false','--join','false','--flatten','false','--simplify','false','--texture-compress','false'],check=True,stdout=subprocess.DEVNULL)
 b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);tri=sum(j['accessors'][x['indices']]['count']//3 for m in j['meshes'] for x in m['primitives'])
 assert len(j['meshes'])==5,'Unexpected model content'
 assert len(j['scenes'])==1 and j['scenes'][0]['name'].startswith('CruiseHull_'),'Unexpected scene content'
 reports.append({'kind':p.name.removesuffix('-hull.glb'),'file':str(p.relative_to(root)),'bytes':len(b),'triangles':tri,'drawCalls':len(j['meshes']),'sha256':hashlib.sha256(b).hexdigest(),'source':'original-blender-authored','coordinates':'Y-up, -Z-forward, waterline Y=0','sourceScript':'scripts/assets/build-anime-hulls.py','optimizer':'glTF Transform 4.5 quantize/weld/prune; no texture palette or geometry simplification'})
(root/'public/assets/ships/hull-manifest.json').write_text(json.dumps({'version':1,'assets':reports},indent=2))
print(len(reports),'assets validated;',sum(a['bytes'] for a in reports),'bytes total')
