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
const MUSIC_PROGRESS_INTERVAL = 0.5;
const MUSIC_PROGRESS_EPSILON = 0.001;
const MUSIC_HANDOFF_CONFIRM_TIME = 1;
interface MusicSlot {
  source: AudioSource;
  name: string;
  target: number;
  started: boolean;
  progressConfirmed: boolean;
  progressBeganAt: number;
  handoffReady: boolean;
  position: number;
  progressAt: number;
  sampleAt: number;
  retryAt: number;
  resumingAt: number;
  resumePending: boolean;
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
  private adSuspensions = 0;
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
        progressConfirmed: false,
        progressBeganAt: -1,
        handoffReady: false,
        position: 0,
        progressAt: 0,
        sampleAt: 0,
        retryAt: 0,
        resumingAt: -1,
        resumePending: false,
        resetAttempted: false,
      };
      slot.source.node.on(
        AudioSource.EventType.STARTED,
        (source: AudioSource) => {
          if (source !== slot.source || !slot.name || !source.playing) return;
          slot.started = true;
          slot.resumePending = false;
          // WeChat's Creator adapter synthesizes onPlay after play(). Only a
          // moving playback clock may confirm success and cancel recovery.
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

  suspendForAd(): () => void {
    this.adSuspensions++;
    if (this.adSuspensions === 1) {
      // Retire the music players before WeChat takes audio focus. A video can
      // leave them INTERRUPTED or falsely PLAYING without a matching show event.
      this.stopAll();
      this.suspended = true;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.adSuspensions--;
      if (!this.isValid || this.adSuspensions > 0) return;
      this.suspended = false;
      // Refresh the current mode, respecting mute and real background state.
      this.refreshMusic();
    };
  }

  play(name: string): void {
    this.unlocked = true;
    this.refreshMusic();
    if (!this.soundEnabled() || this.hidden || this.adSuspensions > 0) return;
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
    if (!this.soundEnabled() || this.hidden || this.adSuspensions > 0 || !this.unlocked) return;
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
    if (!this.soundEnabled() || this.hidden || this.adSuspensions > 0) {
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
    const hasOutgoing = this.musicSlots.some(
      (slot) => slot !== selected && !!slot.name && slot.source.volume > 0.002,
    );
    for (const slot of this.musicSlots) {
      // Keep the old song recoverable even if it is temporarily paused. The
      // new song must advance across the confirmation window before fading in.
      // Only a song still carrying audible gain can bridge this handoff. A
      // retained, silent candidate must not turn into fallback on a reversal.
      const keepOutgoing =
        slot !== selected && !selected?.handoffReady && slot.source.volume > 0.002;
      const playIncoming = slot.target && slot.started && (!hasOutgoing || slot.handoffReady);
      const target = playIncoming || keepOutgoing ? gain : 0;
      const volume = slot.source.volume;
      if (Math.abs(volume - target) >= VOLUME_EPSILON) {
        const next = volume + (target - volume) * (1 - Math.exp(-dt / 0.18));
        // InnerAudioContext forwards every volume write to native audio, even
        // identical values. Finish the fade and tolerate native float rounding
        // so steady music needs no writes.
        slot.source.volume = Math.abs(next - target) < VOLUME_EPSILON ? target : next;
      }
      // Keep the two BGM contexts alive at zero gain between visits. On the
      // PLK110 trace the incoming native clock froze immediately after retiring
      // the outgoing context (stop/seek/destroy), then recovered on replacement.
      // Normal transitions must not run that teardown alongside another loop.
    }
  }

  private refreshMusic(): void {
    // Start when ready; Cocos resumes a blocked browser AudioContext on the first gesture.
    if (!this.soundEnabled() || this.hidden || this.adSuspensions > 0 || !this.musicSlots.length)
      return;
    const name = this.mode === 'home' ? 'music-home' : 'music';
    const clip = this.clips.get(name);
    if (!clip) return;
    const current = this.musicSlots[this.activeMusic];
    if (current?.name === name && current.target === 1) {
      this.refreshMusicSlot(current, clip);
      if (!current.handoffReady) {
        for (const outgoing of this.musicSlots) {
          if (outgoing === current || !outgoing.name || outgoing.source.volume <= 0.002) continue;
          const outgoingClip = this.clips.get(outgoing.name);
          if (outgoingClip) this.refreshMusicSlot(outgoing, outgoingClip);
        }
      }
      return;
    }
    if (current) current.target = 0;
    this.activeMusic = this.activeMusic === 0 ? 1 : 0;
    const incoming = this.musicSlots[this.activeMusic];
    incoming.target = 1;
    if (incoming.name === name && incoming.source.clip === clip) {
      // Reuse both an established loop and its pending initial load. Do not
      // enqueue another PLAY (Creator restarts a playing source) or load the
      // same clip again. Observations made before the silent interval are stale.
      incoming.progressAt = this.clock;
      incoming.sampleAt = this.clock;
      incoming.position = incoming.source.currentTime;
      incoming.progressBeganAt = -1;
      incoming.handoffReady = false;
      if (incoming.resumingAt >= 0) incoming.resumingAt = this.clock;
      this.refreshMusicSlot(incoming, clip);
      return;
    }
    incoming.name = name;
    incoming.started = false;
    incoming.retryAt = this.clock + 1;
    incoming.resumingAt = -1;
    incoming.resetAttempted = false;
    incoming.progressAt = this.clock;
    // A fresh channel must not inherit an unrelated old operation queue:
    // native stop on an already stopped player may never acknowledge completion.
    if (incoming.source.clip) this.replaceMusicSource(incoming);
    this.resetMusicProgress(incoming);
    incoming.source.volume = 0;
    incoming.source.clip = clip;
    incoming.source.play();
  }

  private refreshMusicSlot(current: MusicSlot, clip: AudioClip): void {
    // A selected loop can still be paused/stopped by the platform or audio manager.
    // Leave blocked autoplay and active platform interruptions to Cocos;
    // otherwise bound both the initial play and later resume requests.
    const state = current.source.state;
    if (state === AudioSource.AudioState.INTERRUPTED) {
      // Give the platform time to return audio focus without counting the
      // interruption as a stalled player or recreating audio during it.
      current.progressAt = this.clock;
      if (current.resumingAt >= 0) current.resumingAt = this.clock;
      return;
    }
    if (current.source.playing) {
      current.started = true;
      current.resumePending = false;
      if (this.clock >= current.sampleAt) {
        current.sampleAt = this.clock + MUSIC_PROGRESS_INTERVAL;
        const position = current.source.currentTime;
        if (Number.isFinite(position) && position >= 0) {
          // The clock wrapping at the end of a loop is progress too.
          if (Math.abs(position - current.position) > MUSIC_PROGRESS_EPSILON) {
            current.progressConfirmed = true;
            if (current.progressBeganAt < 0) current.progressBeganAt = this.clock;
            if (this.clock - current.progressBeganAt >= MUSIC_HANDOFF_CONFIRM_TIME)
              current.handoffReady = true;
            current.progressAt = this.clock;
            current.resumingAt = -1;
            if (current.handoffReady) current.resetAttempted = false;
            this.hasPlayedMusic = true;
          }
          current.position = position;
        }
      }
    }
    if (
      !current.progressConfirmed &&
      current.resumingAt < 0 &&
      (this.unlocked || this.hasPlayedMusic || current.started)
    ) {
      current.resumingAt = this.clock;
    }
    const waitingSince =
      current.resumingAt >= 0
        ? current.resumingAt
        : current.progressConfirmed
          ? current.progressAt
          : -1;
    if (
      waitingSince >= 0 &&
      !current.resetAttempted &&
      this.clock - waitingSince >=
        (current.progressConfirmed ? MUSIC_RESUME_TIMEOUT : MUSIC_START_TIMEOUT)
    ) {
      // A missing native onPlay can wedge Cocos' operation queue. Recreate this
      // player once; repeated resets would race slow loads of the same clip.
      const position = current.source.currentTime;
      const volume = current.source.volume;
      current.resetAttempted = true;
      this.replaceMusicSource(current);
      this.resetMusicProgress(current, position);
      current.resumingAt = this.clock;
      current.source.clip = clip;
      current.source.volume = volume;
      if (Number.isFinite(position) && position >= 0) current.source.currentTime = position;
      current.source.play();
      return;
    }
    if (
      current.started &&
      !current.resumePending &&
      (state === AudioSource.AudioState.PAUSED || state === AudioSource.AudioState.STOPPED) &&
      this.clock >= current.retryAt
    ) {
      current.retryAt = this.clock + 1;
      // STARTED completes the engine request even before the next progress
      // sample. A later pause/stop is a new interruption, but must not extend
      // the no-progress deadline or authorize another reset by itself.
      current.resumePending = true;
      if (current.resumingAt < 0) current.resumingAt = this.clock;
      current.progressAt = this.clock;
      current.position = current.source.currentTime;
      current.sampleAt = this.clock + MUSIC_PROGRESS_INTERVAL;
      current.source.play();
    }
  }

  private resetMusicProgress(slot: MusicSlot, position = 0): void {
    slot.started = false;
    slot.resumePending = false;
    slot.progressConfirmed = false;
    slot.progressBeganAt = -1;
    slot.handoffReady = false;
    slot.position = Number.isFinite(position) && position >= 0 ? position : 0;
    slot.progressAt = this.clock;
    slot.sampleAt = this.clock;
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
    this.resetMusicProgress(slot);
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
