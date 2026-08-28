import { MUSIC_BPM } from './constants';

type Sfx =
  | 'punch'
  | 'whiff'
  | 'correct'
  | 'wrong'
  | 'combo'
  | 'countdown'
  | 'go'
  | 'gameover'
  | 'ui'
  | 'monsterHit'
  | 'charge'
  | 'block'
  | 'hurt'
  | 'letter'
  | 'special'
  | 'specialCharge';

/**
 * Every sound is synthesised with the Web Audio API — there are no audio files
 * to 404, so the game always has sound. The public surface is asset-shaped
 * (`play('punch')`), so dropping in real samples later is a change confined to
 * this file.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private musicPlaying = false;

  private musicVolume = 0.45;
  private sfxVolume = 0.8;

  /** Beat callback for scene-wide pulse animation. */
  onBeat: ((index: number) => void) | null = null;

  /** Must be called from a user gesture (the PLAY button). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    // Outside a browser there is nothing to unlock; `play` already no-ops
    // without a context, so the rest of the game runs silently.
    if (typeof window === 'undefined') return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    const musicBus = ctx.createGain();
    musicBus.gain.value = this.musicVolume;
    musicBus.connect(master);

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = this.sfxVolume;
    sfxBus.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.noiseBuffer = createNoiseBuffer(ctx);
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Global duck, used for the pause screen and future accessibility options. */
  setMasterVolume(value: number): void {
    if (this.master) this.master.gain.value = value;
  }

  setMusicVolume(value: number): void {
    this.musicVolume = value;
    if (this.musicBus) this.musicBus.gain.value = value;
  }

  setSfxVolume(value: number): void {
    this.sfxVolume = value;
    if (this.sfxBus) this.sfxBus.gain.value = value;
  }

  // ------------------------------------------------------------------ sfx --

  play(sound: Sfx, param = 0): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    const t = ctx.currentTime;

    switch (sound) {
      case 'punch':
        this.noiseHit(t, 0.16, 900, 0.55);
        this.tone(t, 'sine', 180, 45, 0.14, 0.5, bus);
        break;
      case 'whiff':
        this.noiseHit(t, 0.2, 2600, 0.16);
        break;
      case 'correct': {
        // Bright ascending arpeggio.
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          this.tone(t + i * 0.055, 'triangle', freq, freq, 0.24, 0.32, bus);
        });
        this.tone(t, 'sine', 130, 130, 0.35, 0.2, bus);
        break;
      }
      case 'wrong':
        this.tone(t, 'sawtooth', 200, 62, 0.42, 0.3, bus);
        this.tone(t, 'square', 96, 40, 0.42, 0.22, bus);
        this.noiseHit(t, 0.3, 400, 0.3);
        break;
      case 'combo': {
        // Pitch climbs with the combo tier.
        const base = 880 * Math.pow(2, Math.min(param, 8) / 12);
        this.tone(t, 'square', base, base * 1.5, 0.18, 0.18, bus);
        this.tone(t + 0.06, 'square', base * 1.5, base * 2, 0.18, 0.14, bus);
        break;
      }
      case 'countdown':
        this.tone(t, 'square', 440, 440, 0.14, 0.28, bus);
        break;
      case 'go':
        [523.25, 784, 1046.5].forEach((freq, i) =>
          this.tone(t + i * 0.04, 'square', freq, freq, 0.3, 0.3, bus),
        );
        break;
      case 'gameover': {
        const chord = [392, 311.13, 261.63, 196];
        chord.forEach((freq, i) =>
          this.tone(t + i * 0.14, 'sawtooth', freq, freq * 0.98, 1.1, 0.16, bus),
        );
        break;
      }
      case 'ui':
        this.tone(t, 'square', 660, 880, 0.07, 0.16, bus);
        break;
      case 'monsterHit': {
        // Meaty low thud with a bright shatter on top. `param` is how hard the
        // blow was, so a special-attack barrage climbs instead of repeating.
        const force = param <= 0 ? 1 : Math.min(2, param);
        this.tone(t, 'sine', 150 * force, 48, 0.26 * force, 0.42 * force, bus);
        this.noiseHit(t, 0.22, 1500 * force, 0.34 * force);
        this.tone(t + 0.02, 'triangle', 620 * force, 240, 0.18, 0.16 * force, bus);
        break;
      }
      case 'charge': {
        // Rising, uneasy wind-up that tells the player something is coming.
        this.tone(t, 'sawtooth', 90, 320, 1.9, 0.14, bus, 900);
        this.tone(t, 'square', 45, 160, 1.9, 0.1, bus, 420);
        break;
      }
      case 'block':
        // Metallic clank: short, bright, and clearly *not* damage.
        this.noiseHit(t, 0.12, 3400, 0.4);
        this.tone(t, 'square', 880, 660, 0.14, 0.2, bus);
        this.tone(t + 0.01, 'triangle', 1320, 990, 0.1, 0.12, bus);
        break;
      case 'hurt':
        this.tone(t, 'sawtooth', 240, 55, 0.5, 0.34, bus, 700);
        this.tone(t, 'square', 110, 36, 0.5, 0.24, bus);
        this.noiseHit(t, 0.36, 320, 0.36);
        break;
      case 'letter': {
        // One rung of the word ladder — the pitch climbs with `param`, the
        // index of the letter just connected.
        const step = 660 * Math.pow(2, Math.min(param, 6) / 12);
        this.tone(t, 'square', step, step * 1.5, 0.12, 0.16, bus);
        this.noiseHit(t, 0.08, 4200, 0.12);
        break;
      }
      case 'specialCharge': {
        // The wind-up: a long riser that tells the player something enormous
        // is about to land, and gets out of the way before it does.
        this.tone(t, 'sawtooth', 60, 900, 0.85, 0.16, bus, 2600);
        this.tone(t, 'square', 30, 220, 0.85, 0.12, bus, 700);
        [0, 0.22, 0.42, 0.58, 0.7, 0.79].forEach((at, i) =>
          this.tone(t + at, 'triangle', 330 + i * 110, 440 + i * 150, 0.1, 0.09, bus),
        );
        break;
      }
      case 'special': {
        // The finisher: a hard sweep, a wide chord, and a sub that keeps
        // ringing under the slow motion.
        this.tone(t, 'sawtooth', 240, 1800, 0.5, 0.26, bus, 6000);
        [261.63, 392, 523.25, 784, 1046.5].forEach((freq, i) =>
          this.tone(t + i * 0.04, 'triangle', freq, freq * 1.5, 0.9, 0.22, bus),
        );
        this.noiseHit(t, 0.7, 3000, 0.5);
        this.tone(t + 0.02, 'sine', 150, 32, 1.3, 0.62, bus);
        this.tone(t + 0.05, 'square', 70, 24, 0.9, 0.24, bus, 300);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- music --

  startMusic(): void {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.scheduler();
  }

  stopMusic(): void {
    this.musicPlaying = false;
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  /** Ducks the music while the game is paused, without stopping the clock. */
  setMusicDucked(ducked: boolean): void {
    if (!this.musicBus || !this.ctx) return;
    this.musicBus.gain.setTargetAtTime(
      ducked ? this.musicVolume * 0.18 : this.musicVolume,
      this.ctx.currentTime,
      0.08,
    );
  }

  /**
   * Lookahead scheduler: a timer wakes ~25 ms at a time and queues notes on the
   * audio clock, so tempo never drifts with frame rate.
   */
  private scheduler = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.musicPlaying) return;
    const secondsPerStep = 60 / MUSIC_BPM / 4; // 16th notes

    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += secondsPerStep;
      this.step = (this.step + 1) % 32;
    }
    this.musicTimer = window.setTimeout(this.scheduler, 25);
  };

  private scheduleStep(step: number, time: number): void {
    const bus = this.musicBus;
    if (!bus || !this.ctx) return;

    // Kick on every quarter note, and a beat pulse for the scene.
    if (step % 4 === 0) {
      this.kick(time, bus);
      const beatIndex = step / 4;
      const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);
      window.setTimeout(() => this.onBeat?.(beatIndex), delay);
    }
    // Off-beat hat.
    if (step % 2 === 1) this.hat(time, bus, step % 4 === 3 ? 0.09 : 0.05);
    // Clap on 2 and 4.
    if (step % 8 === 4) this.noiseHit(time, 0.13, 1800, 0.18, bus);

    // Driving bass line.
    const bassPattern = [55, 0, 55, 0, 0, 55, 0, 73.42, 0, 0, 65.41, 0, 0, 49, 0, 0];
    const bass = bassPattern[step % 16];
    if (bass) this.tone(time, 'sawtooth', bass, bass, 0.16, 0.22, bus, 420);

    // Sparse neon arp, second bar only.
    const arp = [0, 0, 1046.5, 0, 0, 1318.5, 0, 0, 1568, 0, 0, 1318.5, 0, 0, 0, 0];
    const note = arp[step % 16];
    if (note && step >= 16) this.tone(time, 'triangle', note, note, 0.12, 0.06, bus);
  }

  // ------------------------------------------------------------ primitives --

  private tone(
    time: number,
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    gain: number,
    bus: GainNode,
    lowpass?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, time);
    if (to !== from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), time + duration);
    }

    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    let tail: AudioNode = env;
    if (lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
      env.connect(filter);
      tail = filter;
    }
    osc.connect(env);
    tail.connect(bus);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private noiseHit(
    time: number,
    duration: number,
    freq: number,
    gain: number,
    bus?: GainNode,
  ): void {
    const ctx = this.ctx;
    const dest = bus ?? this.sfxBus;
    if (!ctx || !dest || !this.noiseBuffer) return;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.35), time + duration);
    filter.Q.value = 1.2;

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(dest);
    src.start(time);
    src.stop(time + duration + 0.02);
  }

  private kick(time: number, bus: GainNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.13);
    env.gain.setValueAtTime(0.55, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
    osc.connect(env);
    env.connect(bus);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  private hat(time: number, bus: GainNode, gain: number): void {
    this.noiseHit(time, 0.045, 8200, gain, bus);
  }

  dispose(): void {
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 1.2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}
