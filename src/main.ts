import './styles.css';
import { GameApp } from './runtime/GameApp';
import { appConfigFromLocation } from './runtime/AppConfig';

const root = document.querySelector<HTMLDivElement>('#game-root');
if (!root) throw new Error('Missing #game-root');

const app = new GameApp(root, appConfigFromLocation());
void app.start().then(()=>document.getElementById('boot')?.remove()).catch((error:unknown)=>{
  console.error('The 3D game could not start.',error);
  const boot=document.getElementById('boot');
  if(boot){boot.replaceChildren();const title=document.createElement('strong');title.textContent='The sea could not load.';const message=document.createElement('small');message.textContent='Reload to try again. The game needs a browser with WebGL 2 enabled.';const retry=document.createElement('button');retry.textContent='RELOAD GAME';retry.onclick=()=>location.reload();boot.append(title,message,retry);}
});
