import { BackSide, Color, Group, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import type { Vec3, WeatherKind } from '../../core/contracts';
import { surfaceTexture } from '../npr/surfaceTextures';
import { atmosphereFor } from './Atmosphere';

const vertex = `varying vec3 vDirection; void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment = `precision highp float;
varying vec3 vDirection;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun;
uniform float uNight; uniform float uTime; uniform float uStorm; uniform float uFog; uniform float uSkyReady;
uniform sampler2D uSkyMap;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
 vec3 d=normalize(vDirection); float h=max(0.,d.y);
 vec3 sky=mix(uHorizon,uZenith,pow(h,.58));
 // The generated asset contains the upper hemisphere: horizon at its bottom, zenith at its top.
 vec2 skyUv=vec2(atan(d.x,d.z)/1.57079633+2.+uTime*.000008,min(1.,.23+h*1.7));
 vec3 painted=texture2D(uSkyMap,skyUv).rgb;
 float luminance=dot(painted,vec3(.2126,.7152,.0722));
 vec3 storm=mix(vec3(luminance),painted,.22)*vec3(.28,.39,.51);
 vec3 night=painted*vec3(.065,.14,.29);
 painted=mix(painted,storm,uStorm); painted=mix(painted,night,uNight);
 painted=mix(painted,uHorizon,uFog*.86);
 sky=mix(sky,painted,uSkyReady*smoothstep(-.02,.035,d.y));
 sky=mix(uHorizon,sky,smoothstep(-.02,.025,d.y));
 float sun=dot(d,normalize(vec3(-.45,.82,.35)));
 sky=mix(sky,uSun,smoothstep(.9991,.9995,sun)*(1.-uStorm)*(1.-uFog));
 sky+=uSun*pow(max(sun,0.),36.)*.045*(1.-uStorm);
 vec2 star=vec2(atan(d.x,d.z)*90.,asin(d.y)*90.); vec2 cell=floor(star);
 float stars=step(.997,hash(cell))*(1.-smoothstep(.04,.16,length(fract(star)-.5)))*smoothstep(.04,.3,h);
 sky+=vec3(stars*uNight*(.5+.25*sin(uTime*.3+hash(cell)*20.)));
 float strike=pow(max(0.,sin(uTime*.73)*sin(uTime*2.13)),48.)*uStorm;
 sky+=vec3(.23,.25,.32)*strike;
 gl_FragColor=vec4(sky,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

/** Original painted cumulus on a camera-relative 3D dome, graded by the shared weather script. */
export class ProceduralSky {
 readonly group=new Group();
 private readonly skyGeometry=new SphereGeometry(2900,40,24);
 private readonly skyMap=surfaceTexture('cinematic-sky');
 private readonly skyMaterial=new ShaderMaterial({name:'CinematicAnimeAtmosphere',vertexShader:vertex,fragmentShader:fragment,side:BackSide,depthWrite:false,uniforms:{uZenith:{value:new Color()},uHorizon:{value:new Color()},uSun:{value:new Color()},uNight:{value:0},uStorm:{value:0},uFog:{value:0},uTime:{value:0},uSkyMap:{value:this.skyMap},uSkyReady:{value:0}}});
 private weather?:WeatherKind;
 constructor(_seed=1){
  const dome=new Mesh(this.skyGeometry,this.skyMaterial); dome.frustumCulled=false; dome.renderOrder=-100;
  this.group.name='CinematicAnimeSky'; this.group.add(dome);
 }
 update(time:number,focus:Vec3,weather:WeatherKind){
  const uniforms=this.skyMaterial.uniforms;
  uniforms.uTime!.value=time; uniforms.uSkyReady!.value=this.skyMap.userData.loaded?1:0;
  if(this.weather!==weather){
   this.weather=weather;const p=atmosphereFor(weather);
   (uniforms.uZenith!.value as Color).setHex(p.zenith);
   (uniforms.uHorizon!.value as Color).setHex(p.horizon);
   (uniforms.uSun!.value as Color).setHex(p.sun);
   uniforms.uNight!.value=weather==='night'?1:0;
   uniforms.uStorm!.value=weather==='storm'||weather==='maelstrom'?1:0;
   uniforms.uFog!.value=weather==='fog'?1:0;
  }
  this.group.position.set(focus.x,0,focus.z);
 }
 dispose(){this.group.removeFromParent();this.skyGeometry.dispose();this.skyMaterial.dispose();}
}
