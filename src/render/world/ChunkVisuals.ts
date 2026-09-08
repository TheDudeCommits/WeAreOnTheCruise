import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, IcosahedronGeometry, Mesh, PlaneGeometry, ShaderMaterial, Shape, type Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandState, Vec3, WeatherKind, WorldCollisionFeature } from '../../core/contracts';
import { createCelMaterial } from '../npr/celMaterial';
import { surfaceTexture } from '../npr/surfaceTextures';

/** World geometry consumes simulation-owned islands and collision features, in bounded merged batches. */
export class ChunkVisuals {
 readonly group=new Group();
 private islands:readonly IslandState[]=[];
 private features:readonly WorldCollisionFeature[]=[];
 private signature='';
 private geometry:BufferGeometry[]=[];
 private readonly cliff=createCelMaterial({name:'LimestoneAndMeadow',surfaceMap:surfaceTexture('limestone'),surfaceScale:.018,surfaceStrength:.23,strata:true,color:0xffffff,vertexColors:true,shadowTint:0x647c99,highlightTint:0xfff2d9,rimStrength:.025,specularThreshold:1.1,bandThresholds:[.23,.62,.89]});
 private readonly plaster=createCelMaterial({color:0xffe1b0,shadowTint:0x9b8fa2,rimStrength:.05,specularThreshold:1.1});
 private readonly roof=createCelMaterial({color:0xb95e3e,shadowTint:0x666682,rimStrength:.04,specularThreshold:1.1});
 private readonly timber=createCelMaterial({color:0x7c553b,rimStrength:.03,specularThreshold:1.1});
 private readonly leaves=createCelMaterial({color:0x3b9870,shadowTint:0x38656c,highlightTint:0xddd99c,rimStrength:.03,side:DoubleSide,specularThreshold:1.1});
 private readonly dark=createCelMaterial({color:0x243346,rimStrength:0,specularThreshold:1.1});
 private readonly sand=createCelMaterial({color:0xf7dda0,shadowTint:0xb9adb6,rimStrength:0,specularThreshold:1.1});
 private readonly water=new ShaderMaterial({name:'WaterfallRibbons',transparent:true,depthWrite:false,side:DoubleSide,uniforms:{uTime:{value:0},uTint:{value:new Color(0xcffaf5)}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`uniform float uTime; uniform vec3 uTint; varying vec2 vUv; void main(){float streak=sin(vUv.x*93.+sin(vUv.y*12.-uTime*3.))*0.5+0.5; float a=smoothstep(0.,.08,vUv.x)*(1.-smoothstep(.88,1.,vUv.x));vec3 c=mix(uTint,vec3(1.),step(.42,streak)); gl_FragColor=vec4(c,a*(.55+streak*.3)); #include <colorspace_fragment> }`.replace('#include <colorspace_fragment> }','\n#include <colorspace_fragment>\n}')});
 private readonly materials:Material[]=[this.cliff,this.plaster,this.roof,this.timber,this.leaves,this.dark,this.sand,this.water];
 constructor(_seed=1,_chunkSize=720){this.group.name='AuthoredArchipelago';}
 setScenarioIslands(islands:readonly IslandState[]){this.islands=islands;this.rebuildIfChanged();}
 setFeatures(features:readonly WorldCollisionFeature[]){this.features=features;this.rebuildIfChanged();}
 update(_focus:Vec3,time=0,weather:WeatherKind='calm'){this.water.uniforms.uTime!.value=time;(this.water.uniforms.uTint!.value as Color).setHex(weather==='night'?0x548baf:weather==='storm'?0x8fb5bd:0xcffaf5);}
 getIslands(){return [...this.islands];}
 getChunkCount(){return 25;}
 dispose(){this.clear();for(const m of this.materials)m.dispose();this.group.removeFromParent();}
 private clear(){this.group.clear();for(const g of this.geometry)g.dispose();this.geometry=[];}
 private rebuildIfChanged(){
  const key=this.islands.map(i=>`${i.id}:${i.position.x}:${i.position.z}:${i.radius}:${i.height}`).join('|')+'#'+this.features.map(f=>f.id).join('|');
  if(key===this.signature)return;this.signature=key;this.clear();
  const buckets=new Map<Material,BufferGeometry[]>();
  const add=(g:BufferGeometry,m:Material,x=0,y=0,z=0,rotation=0)=>{if(m!==this.water)g.deleteAttribute('uv');g.rotateY(rotation);g.translate(x,y,z);if(g.index){const flat=g.toNonIndexed();g.dispose();g=flat;}const list=buckets.get(m)??[];list.push(g);buckets.set(m,list);};
  for(const island of this.islands){
   const {x,z}=island.position,r=island.radius,h=island.height;
   const seed=hash(island.id);
   if(island.landmark==='arches'){
    for(const sign of [-1,1])add(rock(r*.22,h*.55,seed+sign,false),this.cliff,x+r*.76*sign,0,z);
    const shape=new Shape();
    const steps=32;
    for(let i=0;i<=steps;i++){const a=i/steps*Math.PI;const ridge=Math.sin(a)*(Math.sin(i*1.77)*h*.034+Math.sin(i*.57)*h*.042);const px=Math.cos(a)*r*(.98+Math.sin(a)*Math.sin(i*.9)*.035),py=h*.39+Math.sin(a)*h*.61+ridge; if(i===0)shape.moveTo(px,py);else shape.lineTo(px,py);}
    for(let i=steps;i>=0;i--){const a=i/steps*Math.PI;shape.lineTo(Math.cos(a)*r*.54,h*.30+Math.sin(a)*h*.48);}
    shape.closePath();
    const bridge=new ExtrudeGeometry(shape,{depth:r*.35,steps:1,bevelEnabled:true,bevelSize:2.2,bevelThickness:2.2,bevelSegments:1,curveSegments:32}); bridge.translate(0,0,-r*.175);
    const bp=bridge.getAttribute('position');
    for(let i=0;i<bp.count;i++){const bx=bp.getX(i),by=bp.getY(i),bz=bp.getZ(i);bp.setXYZ(i,bx+Math.sin(by*.075+bx*.047)*2.7,by+Math.sin(bx*.16+bz*.09)*1.5,bz+Math.sin(bx*.12+by*.05)*2.7);}
    bridge.computeVertexNormals();tintGeometry(bridge,0xd5d6cd);
    const bc=bridge.getAttribute('color'),bn=bridge.getAttribute('normal');const shade=new Color();
    for(let i=0;i<bp.count;i++){shade.setHex(bn.getY(i)<-.3?0x8294a3:Math.sin(bp.getX(i)*.065+bp.getY(i)*.035)>.45?0xb8c1c1:0xd9d7c8);bc.setXYZ(i,shade.r,shade.g,shade.b);}
    add(bridge,this.cliff,x,0,z);
    for(const sign of [-1,1]){
     for(let ledge=0;ledge<4;ledge++){const offset=sign*r*(.75+.1*Math.sin(ledge*2));add(rock(r*(.105+ledge*.02),h*(.14+ledge*.09),seed+ledge+sign,false),this.cliff,x+offset,0,z-r*.1-ledge*r*.06);}
     add(rock(r*.2,6,seed+sign,true),this.cliff,x+sign*r*.76,h*.51,z);
     for(let p=0;p<4;p++)this.palm(add,x+sign*r*.76+(p-1.5)*5,h*.55,z+(p%2)*8,9+p*1.2,seed+p);
     // Angular slabs and narrow blue-gray fractures sit on the existing pylon footprint.
     for(let k=0;k<12;k++){const a=pseudo(seed+k*19+sign)*Math.PI*2;const elevation=h*(.07+(k%4)*.115);const slab=rock(r*(.035+pseudo(seed+k)*.035),h*(.085+pseudo(seed+k*3)*.08),seed+k*7,false,9);add(slab,this.cliff,x+sign*r*.76+Math.cos(a)*r*.12,elevation,z+Math.sin(a)*r*.12);}
     for(let k=0;k<9;k++){const crownX=x+sign*r*.76+Math.cos(k*2.4)*r*.11,crownZ=z+Math.sin(k*2.4)*r*.11;this.shrub(add,crownX,h*.54,crownZ,4+pseudo(seed+k)*3,seed+k);}
    }
    const fall=new PlaneGeometry(r*.064,h*.54,4,12); add(fall,this.water,x+r*.77,h*.275,z+r*.24);
    for(let v=0;v<15;v++){const a=v/14*Math.PI,px=x+Math.cos(a)*r*.85,py=h*.39+Math.sin(a)*h*.61;this.shrub(add,px,py,z-4,5+pseudo(seed+v)*4,seed+v);if(v%4===0)this.palm(add,px,py+2,z-5,10+v*.25,seed+v);}
    // Small terracotta lookout rooms set the scale of the stone span.
    for(let b=0;b<8;b++){const px=x-r*.76+(b%3-1)*6,pz=z+Math.floor(b/3)*7;add(new BoxGeometry(5,6,5),this.plaster,px,h*.57,pz);add(new CylinderGeometry(0,4.8,3.5,4),this.roof,px,h*.57+4.5,pz,Math.PI*.25);}
    // A village climbs the near face of the left pylon, giving the approach a human scale.
    for(let tier=0;tier<3;tier++){
     const ty=h*(.16+tier*.145),tz=z+r*(.145-tier*.025),tx=x-r*.76;
     add(new BoxGeometry(r*.23,3,r*.085),this.plaster,tx,ty-1.5,tz-r*.03);
     for(let b=0;b<4;b++)this.house(add,tx+(b-1.5)*r*.065,ty,tz-r*.025,5+pseudo(seed+b+tier)*2,8+pseudo(seed+b*7+tier)*5,seed+b+tier*8);
    }
   }else{
    add(rock(r,h,seed,true),this.cliff,x,0,z);
    // Buttresses and recessed ledges follow the same coast footprint. Their
    // angular silhouettes break the cylindrical base at ship-camera scale.
    for(let k=0;k<14;k++){
     const a=k/14*Math.PI*2+pseudo(seed)*.4,rr=r*(.69+pseudo(seed+k*5)*.12);
     const outcropR=r*(.07+pseudo(seed+k*19)*.055),outcropH=h*(.26+pseudo(seed+k*13)*.43);
     add(rock(outcropR,outcropH,seed+k*83,false,11),this.cliff,x+Math.cos(a)*rr,h*.04,z+Math.sin(a)*rr);
     if(k%3===0)this.shrub(add,x+Math.cos(a)*rr,h*.04+outcropH,z+Math.sin(a)*rr,outcropR*.65,seed+k);
    }
    // Warm waterline shelf reads as a beach instead of a stack of cones.
    const beach=new CylinderGeometry(r*1.025,r*1.06,3,36,1);tintGeometry(beach,0xf0d59c);add(beach,this.cliff,x,-1,z);
    if(island.landmark==='needles'){
     for(let k=0;k<5;k++){const a=k/5*Math.PI*2;add(rock(r*.16,h*(.7+pseudo(seed+k)*.8),seed+k,false),this.cliff,x+Math.cos(a)*r*.5,h*.68,z+Math.sin(a)*r*.35);}
    }else if(island.landmark==='volcano'){
     add(rock(r*.45,h*.7,seed+99,false),this.cliff,x,h*.7,z);
    }
    if(island.landmark==='fort')this.fort(add,x,h,z,r);
    else if(island.service==='harbor')this.harbor(add,x,h,z,r,seed);
    else {
     const count=Math.min(12,Math.max(3,Math.round(r/10)));
     for(let k=0;k<count;k++){const a=pseudo(seed+k*37)*Math.PI*2,d=pseudo(seed+k*71)*r*.54;this.palm(add,x+Math.cos(a)*d,h,z+Math.sin(a)*d,7+pseudo(seed+k*7)*8,seed+k);}
     for(let k=0;k<Math.min(20,count*2);k++){const a=k*2.399,d=r*(.15+.4*pseudo(seed+k*31));this.shrub(add,x+Math.cos(a)*d,h,z+Math.sin(a)*d,4+pseudo(seed+k)*5,seed+k);}
    }
   }
  }
  for(const f of this.features){
   if(f.kind==='shore')continue;
   if(this.islands.some(i=>i.id===f.id))continue;
   const g=rock(f.radius,f.kind==='reef'?2:Math.max(8,f.radius*2.3),hash(f.id),false);
   add(g,this.cliff,f.x,f.kind==='reef'?-3:0,f.z);
  }
  for(const [material,list] of buckets){
   // Merged once per streamed region, no per-frame island traversal or material proliferation.
   const merged=mergeGeometries(list,false);for(const g of list)g.dispose();if(!merged)continue;
   const mesh=new Mesh(merged,material);mesh.name=`world-${material.name||material.uuid}`;mesh.receiveShadow=true;mesh.castShadow=material!==this.water;this.group.add(mesh);this.geometry.push(merged);
  }
 }
 private shrub(add:(g:BufferGeometry,m:Material,x?:number,y?:number,z?:number,r?:number)=>void,x:number,y:number,z:number,size:number,seed:number){
  for(let i=0;i<3;i++){const g=new IcosahedronGeometry(size*(.55+pseudo(seed+i)*.22),0);g.scale(1,.6,1);add(g,this.leaves,x+Math.cos(i*2.4)*size*.4,y+size*.32,z+Math.sin(i*2.4)*size*.4);}
 }
 private house(add:(g:BufferGeometry,m:Material,x?:number,y?:number,z?:number,r?:number)=>void,x:number,y:number,z:number,w:number,h:number,seed:number){
  add(new BoxGeometry(w,h,w*.75),this.plaster,x,y+h*.5,z);
  add(new BoxGeometry(w*1.09,.45,w*.87),this.sand,x,y+h,z);
  add(new CylinderGeometry(0,w*.78,3.2,4),this.roof,x,y+h+1.7,z,Math.PI*.25);
  for(let level=0;level<Math.max(1,Math.floor(h/4));level++)for(const dx of [-.24,.24]){
   add(new BoxGeometry(w*.2,1.6,.22),this.dark,x+w*dx,y+2+level*3.4,z+w*.38);
   add(new BoxGeometry(w*.27,.3,.55),this.sand,x+w*dx,y+1.1+level*3.4,z+w*.39);
  }
  add(new BoxGeometry(w*.22,2.7,.25),this.timber,x,y+1.35,z+w*.38);
  if(pseudo(seed)>.35){const awning=new BoxGeometry(w*.7,.25,2.1);awning.rotateX(.15);add(awning,this.roof,x,y+3,z+w*.5);}
 }
 private palm(add:(g:BufferGeometry,m:Material,x?:number,y?:number,z?:number,r?:number)=>void,x:number,y:number,z:number,h:number,seed:number){
  const trunk=new CylinderGeometry(.38,.72,h,7,3);trunk.rotateZ(.09);add(trunk,this.timber,x,y+h*.5,z);
  for(let i=0;i<7;i++){
   const a=i/7*Math.PI*2+pseudo(seed);const len=h*.57;
   const g=new BufferGeometry();const p:number[]=[],indices:number[]=[];
   for(let j=0;j<=6;j++){const t=j/6,width=Math.sin(t*Math.PI)*len*.16;p.push(t*len,Math.sin(t*Math.PI)*len*.18-t*t*len*.25,-width,t*len,Math.sin(t*Math.PI)*len*.18-t*t*len*.25,width);if(j<6){const k=j*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}}
   g.setAttribute('position',new BufferAttribute(new Float32Array(p),3));g.setIndex(indices);g.computeVertexNormals();add(g,this.leaves,x+h*.045,y+h,z,a);
  }
 }
 private harbor(add:(g:BufferGeometry,m:Material,x?:number,y?:number,z?:number,r?:number)=>void,x:number,y:number,z:number,r:number,seed:number){
  for(let i=0;i<36;i++){
   const a=i*2.399,d=r*(.10+.48*Math.sqrt(i/36));const px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d;
   const h=5+pseudo(seed+i)*8,w=6+pseudo(seed+i*3)*6;
   this.house(add,px,y,pz,w,h,seed+i);
  }
  for(let tier=0;tier<3;tier++)for(let b=0;b<6;b++){
   const angle=-Math.PI*.5+(b-2.5)*.13,rr=r*(.88-tier*.07),tx=x+Math.sin(angle)*rr,tz=z+Math.cos(angle)*rr,ty=y*(.23+tier*.23);
   add(new BoxGeometry(13,3,11),this.plaster,tx,ty-1.5,tz);
   this.house(add,tx,ty,tz,7,8+pseudo(seed+b+tier)*5,seed+b+tier*13);
  }
  // Seaward quay, stepped approach and warehouse remain inside the authoritative coast.
  add(new BoxGeometry(11,5,r*.95),this.plaster,x-r*.78,4,z);
  for(let j=0;j<18;j++){const t=j/17;add(new BoxGeometry(10,2.5,4),this.sand,x-r*(.76-.36*t),6+t*(y-6),z+r*.4);}
  for(let j=0;j<9;j++){add(new CylinderGeometry(.6,.65,9,7),this.timber,x-r*.83,3,z-r*.43+j*r*.1);}
  for(let i=0;i<8;i++)this.palm(add,x+r*.45*Math.cos(i),y,z+r*.45*Math.sin(i),10+pseudo(seed+i)*8,seed+i);
  for(let i=0;i<22;i++)this.shrub(add,x+r*.6*Math.cos(i*2.399),y,z+r*.6*Math.sin(i*2.399),4+pseudo(seed+i)*4,seed+i);
  // Distinct beacon makes the harbor legible at naval camera distance.
  add(new CylinderGeometry(6,8,30,16),this.plaster,x+r*.38,y+15,z-r*.25);
  add(new CylinderGeometry(0,8,6,12),this.roof,x+r*.38,y+33,z-r*.25);
  add(new CylinderGeometry(6.3,6.3,4,16),this.dark,x+r*.38,y+24,z-r*.25);
  add(new CylinderGeometry(8,8,.8,16),this.sand,x+r*.38,y+27,z-r*.25);
  for(let i=0;i<8;i++){const a=i/8*Math.PI*2;add(new CylinderGeometry(.3,.3,4,5),this.plaster,x+r*.38+Math.cos(a)*6.3,y+26,z-r*.25+Math.sin(a)*6.3);}
 }
 private fort(add:(g:BufferGeometry,m:Material,x?:number,y?:number,z?:number,r?:number)=>void,x:number,y:number,z:number,r:number){
  const size=r*.92;
  for(let side=0;side<4;side++){
   const angle=side*Math.PI*.5;const px=x+Math.sin(angle)*size*.5,pz=z+Math.cos(angle)*size*.5;
   add(new BoxGeometry(size,16,5),this.plaster,px,y+8,pz,angle);
   for(let c=0;c<9;c++){const off=(c/8-.5)*size;add(new BoxGeometry(4,4,6),this.plaster,px+Math.cos(angle)*off,y+18,pz-Math.sin(angle)*off,angle);}
   for(let c=0;c<5;c++){const off=(c/4-.5)*size*.77;const cannon=new CylinderGeometry(1,1.3,7,8);cannon.rotateX(Math.PI*.5);add(cannon,this.dark,px+Math.cos(angle)*off,y+10,pz-Math.sin(angle)*off,angle);}
  }
  for(const dx of [-1,1])for(const dz of [-1,1]){add(new CylinderGeometry(11,13,27,12),this.plaster,x+dx*size*.5,y+13.5,z+dz*size*.5);add(new CylinderGeometry(12,12,4,12),this.sand,x+dx*size*.5,y+28,z+dz*size*.5);}
  add(new BoxGeometry(30,36,25),this.plaster,x,y+18,z);add(new CylinderGeometry(0,25,12,4),this.roof,x,y+42,z,Math.PI*.25);
  add(new CylinderGeometry(.7,.8,22,8),this.timber,x,y+53,z);
  add(new BoxGeometry(12,7,.15),this.dark,x+6,y+60,z);
 }
}
function rock(radius:number,height:number,seed:number,grass:boolean,segments=48){
 const p:number[]=[],colors:number[]=[],index:number[]=[];
 const levels=[-6,1,height*.2,height*.34,height*.53,height*.75,height*.95,height];
 const scales=[1.01,1,.93,.94,.85,.84,.74,.7];
 const stone=new Color(), c=new Color();
 for(let k=0;k<levels.length;k++)for(let j=0;j<segments;j++){
  const a=j/segments*Math.PI*2;const rough=1+Math.sin(a*5+seed)*.047+Math.sin(a*13-seed)*.045;
  const fracture=(pseudo(seed+Math.floor(j/2)*79)-.5)*.072;
  const terrace=k>0&&k<7?(pseudo(seed+k*53+Math.floor(j/3)*11)-.5)*.045:0;
  const rad=radius*(scales[k]+fracture+terrace)*rough;p.push(Math.cos(a)*rad,levels[k]+(k===0||k===7?0:Math.sin(a*7+seed)*height*.025),Math.sin(a)*rad);
  stone.setHex(k===7&&grass?0x447b5c:k%3===0?0xaab5bb:k%3===1?0xd8d8ca:0xc0c8c5);c.copy(stone).multiplyScalar(.87+pseudo(seed+Math.floor(j/3)*7+k)*.18);colors.push(c.r,c.g,c.b);
 }
 for(let k=0;k<levels.length-1;k++)for(let j=0;j<segments;j++){const a=k*segments+j,b=k*segments+(j+1)%segments,c=a+segments,d=b+segments;index.push(a,c,b,b,c,d);}
 const center=p.length/3;p.push(0,height,0);stone.setHex(grass?0x538864:0xd5d6c9);colors.push(stone.r,stone.g,stone.b);
 for(let j=0;j<segments;j++)index.push(center,7*segments+(j+1)%segments,7*segments+j);
 const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array(p),3));g.setAttribute('color',new BufferAttribute(new Float32Array(colors),3));g.setIndex(index);const flat=g.toNonIndexed();g.dispose();flat.computeVertexNormals();return flat;
}
function tintGeometry(g:BufferGeometry,color:number){const c=new Color(color),array=new Float32Array(g.getAttribute('position').count*3);for(let i=0;i<array.length;i+=3){array[i]=c.r;array[i+1]=c.g;array[i+2]=c.b;}g.setAttribute('color',new BufferAttribute(array,3));}
function pseudo(seed:number){const n=Math.sin(seed*12.9898)*43758.5453;return n-Math.floor(n);}
function hash(text:string){let h=0;for(const c of text)h=(h*31+c.charCodeAt(0))>>>0;return h%10000;}
