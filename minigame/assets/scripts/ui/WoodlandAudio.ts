import { _decorator, AudioClip, AudioSource, Component, Game, Node, game, resources } from 'cc';

const { ccclass } = _decorator;
const CLIPS = [
  'tap',
  'tile',
  'blocked',
  'match',
  'match-four',
  'match-pairs',
  'undo',
  'shovel',
  'hint',
  'shuffle',
  'popup-open',
  'popup-close',
  'reward',
  'stage',
  'win',
  'lose',
  'music-home',
  'music',
  'voice-start',
  'voice-next',
  'voice-win',
  'voice-lose',
];
type MusicMode = 'home' | 'game';
type VoiceCue = 'start' | 'next' | 'win' | 'lose';
const VOLUME_EPSILON = 0.0001;
// Creator's native player may wait eight seconds for canplay before starting.
const MUSIC_START_TIMEOUT = 12;
const MUSIC_RESUME_TIMEOUT = 5;
interface MusicSlot {
  source: AudioSource;
  name: string;
  target: number;
  started: boolean;
  retryAt: number;
  resumingAt: number;
  resetAttempted: boolean;
}

/** Bounded audio channels, gentle music transitions and occasional spoken cues. */
@ccclass('WoodlandAudio')
export class WoodlandAudio extends Component {
  private clips = new Map<string, AudioClip>();
  private effects: AudioSource[] = [];
  private musicSlots: MusicSlot[] = [];
  private voice!: AudioSource;
  private mode: MusicMode = 'home';
  private unlocked = false;
  private hasPlayedMusic = false;
  private ducking = false;
  private loadedCount = 0;
  private hidden = false;
  private suspended = false;
  private soundEnabled: () => boolean = () => false;
  private clock = 0;
  private effectIndex = 0;
  private activeMusic = -1;
  private voiceRemaining = 0;
  private lastVoiceAt = -100;
  private lastVoice = '';
  private lastCue = new Map<string, number>();

  configure(enabled: () => boolean): void {
    this.soundEnabled = enabled;
    const source = (name: string, loop = false) => {
      const node = new Node(name);
      node.parent = this.node;
      const audio = node.addComponent(AudioSource);
      audio.playOnAwake = false;
      audio.loop = loop;
      audio.volume = 0;
      return audio;
    };
    this.effects = Array.from({ length: 4 }, (_, i) => source(`WoodFoley${i}`));
    this.musicSlots = [0, 1].map((i) => {
      const slot: MusicSlot = {
        source: source(`ForestMusic${i}`, true),
        name: '',
        target: 0,
        started: false,
        retryAt: 0,
        resumingAt: -1,
        resetAttempted: false,
      };
      slot.source.node.on(
        AudioSource.EventType.STARTED,
        (source: AudioSource) => {
          if (source !== slot.source || !slot.name || !source.playing) return;
          slot.started = true;
          this.hasPlayedMusic = true;
          slot.resumingAt = -1;
          slot.resetAttempted = false;
        },
        this,
      );
      return slot;
    });
    this.voice = source('ForestVoice');
    this.voice.node.on(
      AudioSource.EventType.ENDED,
      () => {
        // Creator emits ENDED before the backend resets its playing state.
        this.ducking = false;
        this.voiceRemaining = 0;
      },
      this,
    );
    game.on(Game.EVENT_HIDE, this.hide, this);
    game.on(Game.EVENT_SHOW, this.show, this);
    for (const name of CLIPS)
      resources.load(`audio/${name}`, AudioClip, (error, clip) => {
        if (!this.isValid) return;
        if (error) {
          console.warn(`[woodland-audio] Failed to load ${name}`);
          return;
        }
        this.clips.set(name, clip);
        this.loadedCount = this.clips.size;
        if (name === 'music-home' || name === 'music' || this.loadedCount === CLIPS.length)
          this.refreshMusic();
      });
  }

  setMode(mode: MusicMode): void {
    if (mode !== this.mode) {
      this.voice.stop();
      this.ducking = false;
      this.voiceRemaining = 0;
    }
    this.mode = mode;
    this.refreshMusic();
  }

  syncEnabled(): void {
    if (!this.soundEnabled()) {
      this.stopAll();
      return;
    }
    this.unlocked = true;
    this.suspended = false;
    this.refreshMusic();
  }

  play(name: string): void {
    this.unlocked = true;
    this.refreshMusic();
    if (!this.soundEnabled() || this.hidden) return;
    const clip = this.clips.get(name);
    if (!clip) return;
    const interval =
      name === 'tile'
        ? 0.045
        : name === 'tap'
          ? 0.07
          : ['win', 'lose', 'stage'].includes(name)
            ? 0.75
            : 0.09;
    if (this.clock - (this.lastCue.get(name) ?? -100) < interval) return;
    this.lastCue.set(name, this.clock);
    const source = this.effects[this.effectIndex++ % this.effects.length];
    source.stop();
    source.clip = clip;
    source.volume = name.startsWith('popup-')
      ? 0.2
      : name === 'tap'
        ? 0.29
        : name === 'tile'
          ? 0.36
          : 0.48;
    source.play();
  }

  speak(name: VoiceCue): void {
    if (!this.soundEnabled() || this.hidden || !this.unlocked) return;
    const clip = this.clips.get(`voice-${name}`);
    if (
      !clip ||
      (name === 'start' && this.clock - this.lastVoiceAt < 3.5) ||
      (name === this.lastVoice && this.clock - this.lastVoiceAt < 2)
    )
      return;
    this.lastVoiceAt = this.clock;
    this.lastVoice = name;
    this.voice.stop();
    this.voice.clip = clip;
    this.voice.volume = 0.78;
    this.ducking = true;
    this.voiceRemaining = 6;
    this.voice.play();
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.soundEnabled() || this.hidden) {
      if (!this.suspended) this.stopAll();
      this.suspended = true;
      return;
    }
    if (this.suspended) {
      this.suspended = false;
    }
    this.refreshMusic();
    if (this.ducking) {
      this.voiceRemaining -= dt;
      if (this.voiceRemaining <= 0) {
        this.voice.stop();
        this.ducking = false;
      }
    }
    const gain = (this.mode === 'home' ? 0.28 : 0.22) * (this.ducking ? 0.3 : 1);
    const selected = this.musicSlots[this.activeMusic];
    for (const slot of this.musicSlots) {
      // Keep the outgoing loop audible until the next player confirms playback.
      const keepOutgoing = !selected?.started && slot.source.playing;
      const target = (slot.target && slot.started) || keepOutgoing ? gain : 0;
      const volume = slot.source.volume;
      if (Math.abs(volume - target) >= VOLUME_EPSILON) {
        const next = volume + (target - volume) * (1 - Math.exp(-dt / 0.18));
        // InnerAudioContext forwards every volume write to native audio, even
        // identical values. Finish the fade and tolerate native float rounding
        // so steady music needs no writes.
        slot.source.volume = Math.abs(next - target) < VOLUME_EPSILON ? target : next;
      }
      if (!slot.target && !keepOutgoing && slot.name && slot.source.volume < 0.002) {
        this.releaseMusic(slot);
      }
    }
  }

  private refreshMusic(): void {
    // Start when ready; Cocos resumes a blocked browser AudioContext on the first gesture.
    if (!this.soundEnabled() || this.hidden || !this.musicSlots.length) return;
    const name = this.mode === 'home' ? 'music-home' : 'music';
    const clip = this.clips.get(name);
    if (!clip) return;
    const current = this.musicSlots[this.activeMusic];
    if (current?.name === name && current.target === 1) {
      // A selected loop can still be paused/stopped by the platform or audio manager.
      // Leave blocked autoplay and active platform interruptions to Cocos;
      // otherwise bound both the initial play and later resume requests.
      const state = current.source.state;
      if (current.source.playing) {
        current.started = true;
        this.hasPlayedMusic = true;
        current.resumingAt = -1;
        current.resetAttempted = false;
      }
      if (
        !current.started &&
        current.resumingAt < 0 &&
        (this.unlocked || this.hasPlayedMusic) &&
        state !== AudioSource.AudioState.INTERRUPTED
      ) {
        current.resumingAt = this.clock;
      }
      if (
        current.resumingAt >= 0 &&
        !current.resetAttempted &&
        state !== AudioSource.AudioState.INTERRUPTED &&
        this.clock - current.resumingAt >=
          (current.started ? MUSIC_RESUME_TIMEOUT : MUSIC_START_TIMEOUT)
      ) {
        // A missing native onPlay can wedge Cocos' operation queue. Recreate this
        // player once; repeated resets would race slow loads of the same clip.
        const position = current.source.currentTime;
        const volume = current.source.volume;
        current.resetAttempted = true;
        this.replaceMusicSource(current);
        current.source.clip = clip;
        current.source.volume = volume;
        if (Number.isFinite(position) && position >= 0) current.source.currentTime = position;
        current.source.play();
        return;
      }
      if (
        current.started &&
        current.resumingAt < 0 &&
        (state === AudioSource.AudioState.PAUSED || state === AudioSource.AudioState.STOPPED) &&
        this.clock >= current.retryAt
      ) {
        current.retryAt = this.clock + 1;
        current.resumingAt = this.clock;
        current.source.play();
      }
      return;
    }
    if (current) current.target = 0;
    this.activeMusic = this.activeMusic === 0 ? 1 : 0;
    const incoming = this.musicSlots[this.activeMusic];
    const reuse =
      incoming.name === name && incoming.source.clip === clip && incoming.source.playing;
    incoming.name = name;
    incoming.target = 1;
    incoming.started = reuse;
    incoming.retryAt = this.clock + 1;
    incoming.resumingAt = -1;
    incoming.resetAttempted = false;
    // A quick reversal can reuse the still-playing outgoing song. Otherwise
    // discard any old operation queue instead of queuing stop before play:
    // native stop on an already stopped player may never acknowledge completion.
    if (reuse) return;
    if (incoming.source.clip) this.replaceMusicSource(incoming);
    incoming.source.volume = 0;
    incoming.source.clip = clip;
    incoming.source.play();
  }

  private replaceMusicSource(slot: MusicSlot): void {
    const previous = slot.source;
    const node = previous.node;
    previous.volume = 0;
    // WebAudio destruction does not stop its looping BufferSource. Stop only
    // active playback, never enqueue another stop on an already stopped player.
    if (previous.playing) previous.stop();
    previous.clip = null;
    previous.destroy();
    // Creator identifies in-flight loads only by clip identity. A new component
    // prevents a late load of the same clip from replacing a newer player and
    // consuming its queued PLAY. The channel node and its listener stay stable.
    const source = node.addComponent(AudioSource);
    source.playOnAwake = false;
    source.loop = true;
    source.volume = 0;
    slot.source = source;
  }

  private releaseMusic(slot: MusicSlot, replaceSource = true): void {
    if (slot.source.isValid) {
      slot.source.volume = 0;
      // Destroy the player so an abandoned load/play cannot resume later.
      if (slot.source.clip) {
        if (replaceSource) this.replaceMusicSource(slot);
        else {
          if (slot.source.playing) slot.source.stop();
          slot.source.clip = null;
        }
      }
    }
    slot.name = '';
    slot.target = 0;
    slot.started = false;
    slot.resumingAt = -1;
    slot.resetAttempted = false;
  }

  private stopAll(replaceMusicSources = true): void {
    for (const source of [...this.effects, this.voice].filter(Boolean)) {
      if (source.isValid) {
        source.volume = 0;
        source.stop();
      }
    }
    for (const slot of this.musicSlots) this.releaseMusic(slot, replaceMusicSources);
    this.activeMusic = -1;
    this.ducking = false;
    this.voiceRemaining = 0;
  }
  private hide(): void {
    this.hidden = true;
    this.stopAll();
  }
  private show(): void {
    this.hidden = false;
    this.refreshMusic();
  }
  onDestroy(): void {
    game.off(Game.EVENT_HIDE, this.hide, this);
    game.off(Game.EVENT_SHOW, this.show, this);
    this.stopAll(false);
  }
}
