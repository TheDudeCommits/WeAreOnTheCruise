"""Extract still-water hull contours from the actual normalized GLB triangle intersections."""
import json,struct,math,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
result={}
for job in json.loads((ROOT/'scripts/assets/sketchfab-runtime.json').read_text()):
    p=ROOT/'assets/source/sketchfab'/job['uid']/'normalized.glb'
    if not p.exists():continue
    with p.open('rb') as f:
        f.read(12);n,t=struct.unpack('<II',f.read(8));g=json.loads(f.read(n));n,t=struct.unpack('<II',f.read(8));buf=f.read(n)
    def accessor(i):
        a=g['accessors'][i];b=g['bufferViews'][a['bufferView']];typ={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']]
        cnt={'SCALAR':1,'VEC3':3}[a['type']];stride=b.get('byteStride',struct.calcsize(typ)*cnt);off=b.get('byteOffset',0)+a.get('byteOffset',0)
        return [struct.unpack_from('<'+typ*cnt,buf,off+k*stride) for k in range(a['count'])]
    crossings=[]
    for mesh in g['meshes']:
        for prim in mesh['primitives']:
            pos=accessor(prim['attributes']['POSITION']);indices=[v[0] for v in accessor(prim['indices'])]
            for k in range(0,len(indices),3):
                triangle=[pos[i] for i in indices[k:k+3]]
                if min(v[1] for v in triangle)>0 or max(v[1] for v in triangle)<0:continue
                for a,b in zip(triangle,triangle[1:]+triangle[:1]):
                    if a[1]*b[1]>0 or abs(a[1]-b[1])<1e-8:continue
                    t=-a[1]/(b[1]-a[1]);crossings.append((a[0]+t*(b[0]-a[0]),a[2]+t*(b[2]-a[2])))
    points=sorted(set((round(x,5),round(z,5)) for x,z in crossings))
    def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    def half(seq):
        out=[]
        for p in seq:
            while len(out)>1 and cross(out[-2],out[-1],p)<=0:out.pop()
            out.append(p)
        return out[:-1]
    hull=half(points)+half(reversed(points));contour=[]
    for i in range(32):
        dx,dz=math.sin(i/32*math.tau),math.cos(i/32*math.tau);hits=[]
        for a,b in zip(hull,hull[1:]+hull[:1]):
            ex,ez=b[0]-a[0],b[1]-a[1];den=dx*ez-dz*ex
            if abs(den)<1e-8:continue
            r=(a[0]*ez-a[1]*ex)/den;t=(a[0]*dz-a[1]*dx)/den
            if r>0 and 0<=t<=1:hits.append(r)
        if not hits:raise ValueError('No source waterline at '+job['kind']+' angle '+str(i))
        r=max(hits);contour.append([round(dx*r,3),round(dz*r,3)])
    result[job['kind']]=contour
    print(job['kind'],len(crossings),'source crossings')
(ROOT/'src/content/sketchfabWaterlines.json').write_text(json.dumps(result,indent=2)+'\n')
