/**
 * Audio engine (AUDIO-owned; the AudioSystem surface is contract). Stub: unlocks a context and stays silent.
 * The AUDIO agent implements sample playback (CC0/CC-BY assets in public/audio), spatial SFX, music states.
 */
import type { Settings } from '../game/types';
import type { AudioFrame, AudioSystem } from './contracts';

export class AudioEngine implements AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  unlocked = false;

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    await this.context.resume();
    this.unlocked = true;
  }

  update(_frame: AudioFrame): void {}

  setSettings(settings: Settings): void {
    if (this.master) this.master.gain.value = settings.muted ? 0 : settings.masterVolume;
  }

  dispose(): void { void this.context?.close(); }
}
