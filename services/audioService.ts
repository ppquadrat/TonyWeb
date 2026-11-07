

import { MixerState, PitchFrame, Note } from "../types";

const PLAYBACK_LEAD = 0.05; // Seconds between pressing play and the scheduled start
const SCHEDULE_AHEAD = 5; // Seconds of synth events scheduled ahead of the playhead
const SCHEDULER_INTERVAL_MS = 500;

// Index of the first item whose time is >= t (items sorted by time)
const firstIndexAtOrAfter = <T,>(items: T[], timeOf: (item: T) => number, t: number) => {
  let lo = 0, hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeOf(items[mid]) < t) lo = mid + 1; else hi = mid;
  }
  return lo;
};

export class AudioService {
  private context: AudioContext;
  private source: AudioBufferSourceNode | null = null;
  private anchorTime: number = 0; // Context time when play started
  private startOffset: number = 0; // Where in the buffer we started
  private playbackRate: number = 1.0;
  private isPlaying: boolean = false;
  private pauseTime: number = 0; // For returning time when stopped

  // Mixer Nodes
  private masterGain: GainNode;
  
  private originalGain: GainNode;
  private pitchGain: GainNode;
  private notesGain: GainNode;

  // Effects
  private reverbNode: ConvolverNode;

  // Panners
  private pitchPanner: StereoPannerNode;
  private notesPanner: StereoPannerNode;

  // Synth Nodes (f0 Curve)
  private synthOsc: OscillatorNode | null = null;
  private synthGain: GainNode | null = null;
  private vibratoOsc: OscillatorNode | null = null;
  private vibratoGain: GainNode | null = null;

  // Synth Nodes (Notes) - We track active note oscillators to stop them
  private activeNoteNodes: AudioNode[] = [];

  // Synth events are scheduled a few seconds ahead at a time instead of all at once:
  // scheduling a long file in one go blocks the main thread, which delays the start of
  // the audio while the playhead clock is already running (playhead ahead of the audio).
  private schedulerTimer: number | null = null;
  private scheduledUntil = 0; // Buffer time up to which synth events are scheduled
  private pitchFrames: PitchFrame[] = [];
  private pitchIndex = 0;
  private synthNotes: Note[] = [];
  private noteIndex = 0;
  private endBufferTime = Infinity;

  constructor() {
    // Optimization: latencyHint 'playback' encourages the browser to use high-quality resampling/time-stretching algorithms
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.context = new AudioContextClass({ latencyHint: 'playback' });
    
    // Setup Master Mixer
    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);

    // Setup Reverb (Convolver)
    this.reverbNode = this.context.createConvolver();
    this.reverbNode.buffer = this.createReverbImpulse(2.0); // 2 seconds tail
    const reverbMix = this.context.createGain();
    reverbMix.gain.value = 0.3; // 30% Wet
    this.reverbNode.connect(reverbMix);
    reverbMix.connect(this.masterGain);

    // Track Gains
    this.originalGain = this.context.createGain();
    this.pitchGain = this.context.createGain();
    this.notesGain = this.context.createGain();

    // Setup Panners (Spatial Separation)
    this.pitchPanner = this.context.createStereoPanner();
    this.notesPanner = this.context.createStereoPanner();
    
    // Settings: f0 Left, Notes Right
    this.pitchPanner.pan.value = -0.3; 
    this.notesPanner.pan.value = 0.3;

    // Routing
    // Original -> Master (Dry)
    this.originalGain.connect(this.masterGain);
    
    // Pitch -> Panner -> Master & Reverb
    this.pitchGain.connect(this.pitchPanner);
    this.pitchPanner.connect(this.masterGain);
    this.pitchPanner.connect(this.reverbNode);
    
    // Notes -> Panner -> Master & Reverb
    this.notesGain.connect(this.notesPanner);
    this.notesPanner.connect(this.masterGain);
    this.notesPanner.connect(this.reverbNode);
  }

  // Create a synthetic Impulse Response for reverb
  private createReverbImpulse(duration: number): AudioBuffer {
    const rate = this.context.sampleRate;
    const length = rate * duration;
    const impulse = this.context.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        // Exponential decay noise
        const n = i / length;
        const decay = Math.pow(1 - n, 3); 
        left[i] = (Math.random() * 2 - 1) * decay;
        right[i] = (Math.random() * 2 - 1) * decay;
    }
    return impulse;
  }

  get currentTime() {
    return this.getCurrentTime();
  }

  updateMixer(state: MixerState) {
    const now = this.context.currentTime;
    const rampTime = 0.1;
    
    const origVol = state.originalEnabled ? state.originalVolume : 0.0;
    const pitchVol = state.pitchEnabled ? state.pitchVolume : 0.0;
    const notesVol = state.notesEnabled ? state.notesVolume : 0.0;

    this.originalGain.gain.setTargetAtTime(origVol, now, rampTime);
    this.pitchGain.gain.setTargetAtTime(pitchVol, now, rampTime); 
    this.notesGain.gain.setTargetAtTime(notesVol, now, rampTime);
  }

  async decodeAudio(file: File): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    return await this.context.decodeAudioData(arrayBuffer);
  }

  play(
      buffer: AudioBuffer, 
      pitchData: PitchFrame[], 
      notes: Note[], 
      startOffset: number = 0, 
      duration?: number,
      playbackRate: number = 1.0
  ) {
    if (this.isPlaying) this.stop();

    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    // Start everything at one explicit context time, slightly ahead, so the audio
    // and the playhead clock share the same origin
    this.anchorTime = this.context.currentTime + PLAYBACK_LEAD;
    this.startOffset = startOffset;
    this.playbackRate = playbackRate;
    this.isPlaying = true;

    // 1. Setup Original Audio Source
    this.source = this.context.createBufferSource();
    
    // STRICT ORDERING: 
    // 1. Assign Buffer
    this.source.buffer = buffer;

    // 2. Enable Pitch Preservation (Time Stretching)
    // We explicitly set this property before touching playbackRate
    const src = this.source as any;
    src.preservesPitch = true;
    src.mozPreservesPitch = true;
    src.webkitPreservesPitch = true;
    
    // 3. Set Playback Rate
    this.source.playbackRate.value = playbackRate;

    this.source.connect(this.originalGain);
    
    // source.start takes (when, offset, duration)
    if (duration !== undefined) {
      this.source.start(this.anchorTime, startOffset, duration);
    } else {
      this.source.start(this.anchorTime, startOffset);
    }

    this.endBufferTime = duration !== undefined ? startOffset + duration : Infinity;
    this.scheduledUntil = startOffset;

    // 2. Setup Pitch Synthesizer (Continuous)
    this.pitchFrames = pitchData ?? [];
    this.pitchIndex = firstIndexAtOrAfter(this.pitchFrames, f => f.timestamp, startOffset);
    if (this.pitchFrames.length > 0) {
      this.startPitchSynth(duration);
    }

    // 3. Setup Note Synthesizer (Discrete)
    this.synthNotes = [...(notes ?? [])].sort((a, b) => a.start - b.start);
    this.noteIndex = 0;
    this.activeNoteNodes = [];

    // 4. Schedule synth events in a window ahead of the playhead
    this.scheduleAhead();
    this.schedulerTimer = window.setInterval(() => this.scheduleAhead(), SCHEDULER_INTERVAL_MS);
  }

  // Schedule pitch and note synth events up to SCHEDULE_AHEAD seconds past the playhead
  private scheduleAhead() {
    if (!this.isPlaying) return;
    const target = Math.min(this.endBufferTime, Math.max(this.getCurrentTime(), this.startOffset) + SCHEDULE_AHEAD);
    if (target <= this.scheduledUntil) return;
    this.schedulePitch(this.scheduledUntil, target);
    this.scheduleNotes(target);
    this.scheduledUntil = target;
  }

  // Map buffer time to context time
  private toContextTime(bufferTime: number) {
    return this.anchorTime + (bufferTime - this.startOffset) / this.playbackRate;
  }

  private startPitchSynth(duration?: number) {
    const now = this.context.currentTime;
    
    // Calculate stop time in Context Domain (Wall Clock)
    // Wall Duration = Buffer Duration / Rate
    const wallDuration = duration !== undefined ? duration / this.playbackRate : undefined;
    const stopTime = wallDuration !== undefined ? this.anchorTime + wallDuration : undefined;
    
    // Sound Design: Smooth "Humming" (Triangle)
    // We make this softer (lower cutoff) to contrast with the bright notes
    this.synthOsc = this.context.createOscillator();
    this.synthOsc.type = 'triangle'; 

    // Vibrato
    this.vibratoOsc = this.context.createOscillator();
    this.vibratoOsc.frequency.value = 5.0; 
    this.vibratoGain = this.context.createGain();
    this.vibratoGain.gain.value = 3; // Reduced vibrato depth slightly
    
    this.vibratoOsc.connect(this.vibratoGain);
    this.vibratoGain.connect(this.synthOsc.detune);
    this.vibratoOsc.start(0);

    // Filter - Lower cutoff to make it background/bass-like
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400; // Lowered from 600

    this.synthGain = this.context.createGain();
    this.synthGain.gain.setValueAtTime(0, now); // Initialize to 0

    // Chain
    this.synthOsc.connect(filter);
    filter.connect(this.synthGain);
    this.synthGain.connect(this.pitchGain);

    this.synthOsc.start(0);
    if (stopTime !== undefined) {
        this.synthOsc.stop(stopTime);
        this.vibratoOsc?.stop(stopTime);
    }
  }

  // Schedule pitch synth automation for frames in [from, to) (buffer time)
  private schedulePitch(_from: number, to: number) {
    if (!this.synthOsc || !this.synthGain) return;
    const now = this.context.currentTime;
    const frames = this.pitchFrames;
    for (; this.pitchIndex < frames.length; this.pitchIndex++) {
        const frame = frames[this.pitchIndex];
        if (frame.timestamp >= to || frame.timestamp > this.endBufferTime) break;

        // MATH: We must map "Buffer Time" to "Context Time"
        const scheduleTime = this.toContextTime(frame.timestamp);
        if (scheduleTime < now) continue;

        if (frame.hasPitch && frame.frequency > 0) {
            // Using linearRamp for more stable pitch tracking at slow speeds
            this.synthOsc.frequency.linearRampToValueAtTime(frame.frequency, scheduleTime);
            this.synthGain.gain.linearRampToValueAtTime(0.7, scheduleTime);
        } else {
            this.synthGain.gain.linearRampToValueAtTime(0.0, scheduleTime);
        }
    }
  }

  // --- PULSE / CLARINET NOTE ENGINE ---
  // Replaces the Formant Vocal engine for a snappier, clearer sound
  private createPulseNotePatch(freq: number, startTime: number, dur: number): AudioNode[] {
     const t = startTime;
     
     // 1. Source: Square Wave (Clarinet/Gameboy style) - Very distinct pitch
     const osc = this.context.createOscillator();
     osc.type = 'square';
     osc.frequency.setValueAtTime(freq, t);

     // 2. Filter: Lowpass to round off the harsh edges, but keep it bright
     const filter = this.context.createBiquadFilter();
     filter.type = 'lowpass';
     filter.frequency.value = 2000;
     filter.Q.value = 1;

     // 3. Envelope
     const env = this.context.createGain();
     env.gain.setValueAtTime(0, t);
     
     // ADSR
     // Fast Attack for Snappy Onset
     const attack = Math.min(0.015, dur * 0.1); 
     const decay = Math.min(0.1, dur * 0.3);
     const release = Math.min(0.05, dur * 0.2);
     const sustainLevel = 0.6;
     
     env.gain.linearRampToValueAtTime(0.8, t + attack); // Peak volume
     env.gain.linearRampToValueAtTime(sustainLevel, t + attack + decay); // Decay to sustain
     env.gain.setValueAtTime(sustainLevel, t + dur - release);
     env.gain.linearRampToValueAtTime(0, t + dur);

     // Connect
     osc.connect(filter);
     filter.connect(env);
     env.connect(this.notesGain);

     osc.start(t);
     osc.stop(t + dur);

     return [osc, env, filter];
  }

  // Schedule note voices that start before `to` (buffer time)
  private scheduleNotes(to: number) {
      const now = this.context.currentTime;
      const notes = this.synthNotes;

      for (; this.noteIndex < notes.length; this.noteIndex++) {
          const note = notes[this.noteIndex];
          if (note.start >= to || note.start > this.endBufferTime) break;
          if (note.end < this.startOffset) continue;

          // Map Buffer Time to Context Time with Speed Scaling
          const noteStartTime = Math.max(now, this.toContextTime(note.start));
          const noteEndTime = this.toContextTime(Math.min(note.end, this.endBufferTime));
          
          if (noteEndTime < now) continue;
          
          let wallDur = noteEndTime - noteStartTime;
          if (wallDur < 0.05) wallDur = 0.05; 

          // Create a voice
          // Note: Pitch remains the same (note.pitch)
          const nodes = this.createPulseNotePatch(note.pitch, noteStartTime, wallDur);
          this.activeNoteNodes.push(...nodes);
      }
  }

  stop() {
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.source) {
      try { 
          if (this.source instanceof AudioScheduledSourceNode) {
            this.source.stop(); 
          }
      } catch (e) {}
      this.source.disconnect();
      this.source = null;
    }

    // Cleanup f0 synth
    if (this.synthOsc) {
        try { this.synthOsc.stop(); } catch (e) {}
        this.synthOsc.disconnect();
        this.synthOsc = null;
    }
    if (this.vibratoOsc) {
        try { this.vibratoOsc.stop(); } catch (e) {}
        this.vibratoOsc.disconnect();
        this.vibratoOsc = null;
    }

    // Cleanup Note nodes
    this.activeNoteNodes.forEach(node => {
        try { 
            if (node instanceof AudioScheduledSourceNode) {
                node.stop();
            }
        } catch(e) {}
        node.disconnect();
    });
    this.activeNoteNodes = [];

    // Clear internal gain nodes if needed or reset
    if (this.vibratoGain) { this.vibratoGain.disconnect(); this.vibratoGain = null; }
    if (this.synthGain) { this.synthGain.disconnect(); this.synthGain = null; }

    this.isPlaying = false;
    // Calculate exact buffer position where we stopped
    // elapsedBufferTime = (ctx.currentTime - anchorTime) * rate
    const elapsed = Math.max(0, this.context.currentTime - this.getOutputLatency() - this.anchorTime) * this.playbackRate;
    this.pauseTime = this.startOffset + elapsed;
  }

  getCurrentTime(): number {
    if (!this.isPlaying) return this.pauseTime;
    // elapsedBufferTime = (ctx.currentTime - anchorTime) * rate
    // Before the scheduled start (PLAYBACK_LEAD) the playhead stays at the start offset.
    // The context clock runs ahead of what is heard by the output latency, which can be
    // large with latencyHint 'playback', so subtract it to keep the playhead on the sound.
    const heardTime = this.context.currentTime - this.getOutputLatency();
    const elapsed = Math.max(0, heardTime - this.anchorTime) * this.playbackRate;
    return this.startOffset + elapsed;
  }

  private getOutputLatency(): number {
    const ctx = this.context as AudioContext & { outputLatency?: number };
    const latency = (ctx.outputLatency ?? 0) || (ctx.baseLatency ?? 0);
    return Number.isFinite(latency) ? Math.max(0, Math.min(latency, 1)) : 0;
  }
}

export const audioService = new AudioService();
