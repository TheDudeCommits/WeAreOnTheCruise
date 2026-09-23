"""Run inside Blender via MCP. Original modeled hulls; no downloaded assets.
Coordinates authored from gameplay X/Y-up/-Z-forward, converted to Blender Z-up.
Meshes consolidated per semantic material; runtime keeps masts/cannons/crew separate.
"""
import math, json, os, pathlib, sys

def resolve_project_root():
 message='Set CRUISE_PROJECT_ROOT to the absolute WeAreOnTheCruise checkout path, or run this file with Blender --python.'
 explicit=globals().get('CRUISE_PROJECT_ROOT') or os.environ.get('CRUISE_PROJECT_ROOT')
 try:
  if explicit:
   root=pathlib.Path(explicit).expanduser()
   if not root.is_absolute():raise ValueError('Project root must be absolute')
   root=root.resolve()
  else:
   source=globals().get('__file__')
   if not source or not pathlib.Path(source).is_file():raise ValueError('No script path')
   root=pathlib.Path(source).resolve().parents[2]
  package=json.loads((root/'package.json').read_text())
  if package.get('name')!='we-are-on-the-cruise' or not (root/'src/content/shipSpecs.ts').is_file() or not (root/'scripts/assets/build-anime-hulls.py').is_file():
   raise ValueError('Not a Cruise checkout')
 except (OSError, ValueError, TypeError, IndexError):
  raise SystemExit(message) from None
 return root

ROOT=str(resolve_project_root())
SPECS=[('thousand-sunny',56,22,7),('going-merry',34,13,4.2),('moby-dick',122,48,15),('red-force',78,27,9.5),('oro-jackson',82,29,10),('queen-mama-chanter',108,44,14),('baratie',74,34,8),('navy-galleon',70,25,9)]
if '--dry-run' in sys.argv:
 print(json.dumps({'projectRoot':ROOT,'exports':['public/assets/ships/'+kind+'-hull.glb' for kind,*_ in SPECS],'dryRun':True},indent=2))
 raise SystemExit(0)

import bpy
from mathutils import Vector
COLORS={'hull':(0.48,.13,.075,1),'hullDark':(.17,.055,.025,1),'trim':(.92,.62,.14,1),'deck':(.64,.40,.16,1),'metal':(.07,.10,.14,1),'seam':(.18,.09,.055,1)}
scene=bpy.data.scenes.new('Cruise Cinematic Anime Hull Workshop R2')
previous=bpy.context.window.scene
bpy.context.window.scene=scene
materials={}
for name,color in COLORS.items():
 m=bpy.data.materials.new('CruiseHull_'+name);m.diffuse_color=color;m.use_nodes=True
 bsdf=m.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=color;bsdf.inputs['Roughness'].default_value=.78
 materials[name]=m

def convert(v):return (v[0],-v[2],v[1])
def mesh(name,verts,faces,material,collection):
 data=bpy.data.meshes.new(name);data.from_pydata([convert(v) for v in verts],[],faces);data.materials.append(materials[material]);data.update()
 obj=bpy.data.objects.new(name,data);collection.objects.link(obj)
 return obj

def tube(name,points,radius,material,collection,sides=6):
 verts=[]; faces=[]
 for i,p in enumerate(points):
  delta=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
  delta.normalize(); ref=Vector((0,1,0))
  if abs(delta.dot(ref))>.95:ref=Vector((1,0,0))
  u=delta.cross(ref).normalized();v=delta.cross(u).normalized()
  for k in range(sides):verts.append(Vector(p)+(u*math.cos(k*2*math.pi/sides)+v*math.sin(k*2*math.pi/sides))*radius)
  if i:
   for k in range(sides):faces.append(((i-1)*sides+k,(i-1)*sides+(k+1)%sides,i*sides+(k+1)%sides,i*sides+k))
 return mesh(name,verts,faces,material,collection)

def width(t,B):return B*.49*max(.015,math.sin(math.pi*t))**.43

def top(t,D):return D*.17+1.44+abs(t-.5)**2*D*1.5

reports=[]
for kind,L,B,D in SPECS:
 coll=bpy.data.collections.new('CruiseHull_'+kind);scene.collection.children.link(coll)
 # Eight curved strakes with modeled narrow seams replace the rectangular flat hull.
 for band in range(8):
  verts=[];faces=[]
  for i in range(33):
   t=i/32;w=width(t,B);z=(t-.5)*L;rail=top(t,D)
   for s in [-1,1]:
    for j in [band/8+.006,(band+1)/8-.006]:
     x=s*w*(.10+.90*math.sin(j*math.pi/2))
     y=-D*.80+(rail+D*.8)*j
     verts.append((x,y,z))
   if i:
    n=i*4;p=n-4;faces.extend([(p,n,n+1,p+1),(p+2,p+3,n+3,n+2)])
  obj=mesh(kind+'_strake_'+str(band),verts,faces,'hullDark' if band<3 else 'hull',coll)
  for p in obj.data.polygons:p.use_smooth=True
 # Spline-like sheer rails and gunwale follow hull silhouette.
 for side in [-1,1]:
  for j in [.58,.88,1.0]:
   points=[]
   for i in range(33):
    t=i/32;w=width(t,B);rail=top(t,D)
    points.append((side*w*(.10+.90*math.sin(j*math.pi/2)),-D*.8+(rail+D*.8)*j+.04,(t-.5)*L))
   tube(kind+'_wale',points,max(.08,B*.009),'trim' if j>.8 else 'hullDark',coll)
 # Curved forecastle/transom silhouette, with individual deck boards.
 deckY=D*.17+1.44
 for board in range(18):
  x0=(board/18-.5)*B*.88;x1=((board+1)/18-.5)*B*.88
  verts=[];faces=[]
  for i in range(31):
   t=.05+i/30*.90;w=width(t,B)*.93;z=(t-.5)*L
   a=max(-w,min(w,x0+.018));b=max(-w,min(w,x1-.018))
   verts.extend([(a,deckY,z),(b,deckY,z)])
   if i:faces.append((2*i-2,2*i,2*i+1,2*i-1))
  mesh(kind+'_deck_plank',verts,faces,'deck',coll)
 # Stanchions and twin rope/wood rails, with open gaps for cannon broadsides.
 for side in [-1,1]:
  for i in range(17):
   t=.07+i/16*.86;z=(t-.5)*L;x=side*width(t,B)*.94
   tube(kind+'_railpost',[(x,deckY,z),(x,deckY+1.7,z)],max(.065,B*.005),'trim',coll)
  for railH in [.7,1.7]:
   pts=[(side*width(.07+i/32*.86,B)*.94,deckY+railH,(.07+i/32*.86-.5)*L) for i in range(33)]
   tube(kind+'_railing',pts,max(.05,B*.004),'hullDark' if railH<1 else 'trim',coll)
 # Foredeck cap, transom tier and curved boarding steps.
 for side in [-1,1]:
  for i in range(5):
   z=L*.07+i*.46
   tube(kind+'_deckstep',[(side*B*.28,deckY+.15+i*.10,z),(side*B*.41,deckY+.15+i*.10,z)],.11,'trim',coll)
 # Rivet heads and gunport dark recesses provide strong mid-distance detail.
 for side in [-1,1]:
  for i in range(8):
   t=.25+i/7*.50;z=(t-.5)*L;x=side*width(t,B)*.97;y=D*.1
   verts=[(x,y-.55,z-.60),(x,y-.55,z+.60),(x,y+.55,z+.60),(x,y+.55,z-.60)]
   mesh(kind+'_gunport',verts,[(0,1,2,3)],'metal',coll)
 # Join by material to six or fewer draw calls.
 for key in materials:
  candidates=[o for o in coll.objects if o.type=='MESH' and o.data.materials and o.data.materials[0]==materials[key]]
  if not candidates:continue
  bpy.ops.object.select_all(action='DESELECT')
  for o in candidates:o.select_set(True)
  bpy.context.view_layer.objects.active=candidates[0]
  bpy.ops.object.join(); obj=candidates[0];obj.name='hull-role-'+key
  # mesh normals are authored into GLB and geometry stays shared between instances.
 bpy.ops.object.select_all(action='DESELECT')
 for o in coll.objects:o.select_set(True)
 filepath=ROOT+'/public/assets/ships/'+kind+'-hull.glb'
 bpy.ops.export_scene.gltf(filepath=str(filepath),export_format='GLB',use_selection=True,use_active_scene=True,collection=coll.name,export_yup=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
 reports.append({'kind':kind,'file':'public/assets/ships/'+kind+'-hull.glb','triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in coll.objects),'drawCalls':len(coll.objects),'source':'original-blender-authored','coordinates':'Y-up, -Z-forward, waterline Y=0'})
 # Hide completed kit while authoring next one; preserves all editable collections.
 for o in coll.objects:o.hide_set(True)

bpy.context.window.scene=previous
print(json.dumps(reports))
