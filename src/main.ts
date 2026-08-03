import './styles.css';
import { GameApp } from './runtime/GameApp';
import { appConfigFromLocation } from './runtime/AppConfig';

const root = document.querySelector<HTMLDivElement>('#game-root');
if (!root) throw new Error('Missing #game-root');

const app = new GameApp(root, appConfigFromLocation());
void app.start();
