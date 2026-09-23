"""Run through Blender MCP with the job JSON substituted by the caller.

Imports the official source GLB, bakes only a uniform scale/rotation/translation,
and exports the existing meshes and materials. It never builds replacement hulls.
No credentials, unrelated scenes, cameras or lights enter the export.
"""
import bpy, json, math
from mathutils import Matrix, Vector

JOB = json.loads('__CRUISE_JOB_JSON__')
root = '/Users/amir/Projects/WeAreOnTheCruise'
previous = bpy.context.scene
source = bpy.data.scenes.new('Cruise-Sketchfab-source-' + JOB['uid'])
bpy.context.window.scene = source
bpy.ops.import_scene.gltf(filepath=root + '/assets/source/sketchfab/' + JOB['uid'] + '/source.glb')
bpy.context.view_layer.update()
meshes = [obj for obj in source.objects if obj.type == 'MESH']
depsgraph = bpy.context.evaluated_depsgraph_get()
captured = [(obj.name, bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph)), obj.matrix_world.copy()) for obj in meshes]
rotation = Matrix.Rotation(math.radians(JOB['yaw']), 4, 'Z')
points = [rotation @ world @ vertex.co for name, data, world in captured for vertex in data.vertices]
low = Vector([min(v[i] for v in points) for i in range(3)])
high = Vector([max(v[i] for v in points) for i in range(3)])
scale = JOB['length'] / (high.y - low.y)
origin = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
transform = Matrix.Translation((0, 0, JOB['keel'])) @ Matrix.Scale(scale, 4) @ Matrix.Translation(-origin) @ rotation
stage = bpy.data.scenes.new('Cruise-Sketchfab-export-' + JOB['uid'])
for name, data, world in captured:
    obj = bpy.data.objects.new(name, data)
    obj.data.transform(transform @ world)
    stage.collection.objects.link(obj)
if JOB.get('style') == 'moby':
    colors = [('Ivory whale hull',(.72,.78,.8,1)),('Linen sails',(.84,.76,.58,1)),('Mahogany spars',(.13,.047,.023,1)),('Warm timber deck',(.26,.12,.045,1)),('Deep keel',(.022,.044,.068,1))]
    palette = []
    for name, color in colors:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        material.diffuse_color = color
        material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color
        material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .82
        palette.append(material)
    for obj in stage.objects:
        obj.data.materials.clear()
        for material in palette:obj.data.materials.append(material)
        obj.data.update()
        for face in obj.data.polygons:
            center = sum((obj.data.vertices[i].co for i in face.vertices), Vector()) / len(face.vertices)
            if center.z < -7:role = 4
            elif center.y > 29 and center.z < 24:role = 0
            elif center.z < 21:role = 3 if face.normal.z > .6 and center.z > 6 else 0
            else:role = 1 if abs(face.normal.y) > .6 and face.area > .3 else 2
            face.material_index = role
if JOB.get('style') == 'baratie':
    colors = [('Sea green hull',(.025,.16,.09,1)),('Cream sailcloth',(.88,.78,.59,1)),('Mahogany masts',(.12,.042,.02,1)),('Timber promenade',(.3,.13,.045,1)),('Ivory trim',(.87,.77,.55,1)),('Warm restaurant walls',(.68,.43,.19,1)),('Crimson roofs',(.39,.045,.035,1)),('Rose fish bow',(.73,.2,.27,1))]
    palette=[]
    for name,color in colors:
        material=bpy.data.materials.new(name);material.use_nodes=True;material.diffuse_color=color
        material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=color
        material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.82
        palette.append(material)
    for obj in stage.objects:
        obj.data.materials.clear()
        for material in palette:obj.data.materials.append(material)
        obj.data.update()
        for face in obj.data.polygons:
            center=sum((obj.data.vertices[i].co for i in face.vertices),Vector())/len(face.vertices)
            if center.z<0:role=0
            elif abs(center.x)>20:role=3 if face.normal.z>.65 else 4
            elif center.y>22 and center.z<24:role=7
            elif center.z<10:role=0
            elif center.z<32:
                role=5
                if face.normal.z>.65:role=6 if center.z>26 else 3
                elif face.area<.12:role=4
            else:role=1 if abs(face.normal.y)>.62 and face.area>.05 else 2
            face.material_index=role
bpy.context.window.scene = stage
bpy.context.view_layer.update()
output = root + '/assets/source/sketchfab/' + JOB['uid'] + '/normalized.glb'
bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', use_active_scene=True, export_yup=True, export_extras=False)

# Source review is a separate Blender render, never an in-game screenshot.
points = [Vector(v) for obj in stage.objects if obj.type == 'MESH' for v in obj.bound_box]
low = Vector([min(v[i] for v in points) for i in range(3)])
high = Vector([max(v[i] for v in points) for i in range(3)])
center = (low + high) / 2
camera_data = bpy.data.cameras.new('Cruise-source-review')
camera = bpy.data.objects.new('Cruise-source-review', camera_data)
stage.collection.objects.link(camera)
camera.location = center + Vector((.9, 1.25, .65)) * JOB['length']
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = max((high.z-low.z) * 1.34, JOB['length'], high.x-low.x) * 1.45
stage.camera = camera
stage.render.engine = 'BLENDER_EEVEE'
stage.render.resolution_x = 1200
stage.render.resolution_y = 900
stage.render.resolution_percentage = 100
stage.world = bpy.data.worlds.new('Cruise-source-review-world')
stage.world.use_nodes = True
stage.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.22,.27,.34,1)
stage.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .7
light_data = bpy.data.lights.new('Cruise-source-review-sun', 'SUN')
light_data.energy = 2.5
light = bpy.data.objects.new('Cruise-source-review-sun', light_data)
stage.collection.objects.link(light)
light.rotation_euler = (.45,-.5,-.7)
stage.view_settings.view_transform = 'Standard'
stage.render.filepath = root + '/output/asset-gauntlet/' + JOB['uid'] + '-source.png'
bpy.ops.render.render(write_still=True)
print(json.dumps({'uid':JOB['uid'], 'export':output, 'render':stage.render.filepath,
                  'uniformScale':scale, 'yaw':JOB['yaw'], 'boundsMin':list(low), 'boundsMax':list(high),
                  'meshes':len(meshes), 'vertices':sum(len(o.data.vertices) for o in meshes),
                  'triangles':sum(len(o.data.polygons) for o in meshes)}))
bpy.context.window.scene = previous
