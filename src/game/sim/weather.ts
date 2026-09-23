/** Sea state over a run: time of day, weather schedule and crossfades (META-owned skeleton). */
import type { WeatherId } from '../ids';
import type { SimContext } from './context';

const WAVE_SCALE: Record<WeatherId, number> = { clear: 0.8, breezy: 1.1, storm: 1.7, fog: 0.7 };
const WIND: Record<WeatherId, number> = { clear: 0.45, breezy: 0.7, storm: 1, fog: 0.25 };

export function updateSeaState(c: SimContext): void {
  const s = c.state;
  const sea = c.content.seas[s.seaId];
  const st = s.sea;
  st.timeOfDay = (sea.startHour + (s.time / sea.duration) * sea.hoursPerRun) % 24;
  let scheduled: WeatherId = st.weather;
  for (const w of sea.weather) if (s.time >= w.at) scheduled = w.weather;
  if (scheduled !== st.nextWeather) { st.nextWeather = scheduled; st.blend = 0; c.emit({ type: 'weather-changed', weather: scheduled }); }
  if (st.blend < 1) {
    st.blend = Math.min(1, st.blend + c.dt / 6);
    if (st.blend >= 1) st.weather = st.nextWeather;
  }
  const from = st.weather, to = st.nextWeather, k = st.blend;
  st.waveScale = WAVE_SCALE[from] * (1 - k) + WAVE_SCALE[to] * k;
  st.windStrength = WIND[from] * (1 - k) + WIND[to] * k;
  st.fog = (from === 'fog' ? 1 - k : 0) + (to === 'fog' ? k : 0);
  st.rain = (from === 'storm' ? 1 - k : 0) + (to === 'storm' ? k : 0);
}
