
import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import Controls from './components/Controls';
import WaveformNavigator from './components/WaveformNavigator';
import PitchVisualizer from './components/PitchVisualizer';
import Mixer from './components/Mixer';
import { audioService } from './services/audioService';
import { extractPitch, YIN_HOP_SIZE } from './services/yin';
import { generateSpectrogram } from './services/spectrogram';
import { generateProjectJSON, generatePitchCSV, generateNotesCSV, generateSVL, parseProjectJSON, parseCSV } from './services/exportService';
import { AnalysisState, MixerState, PitchFrame, Note, SpectrogramData } from './types';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { calculateMedianPitch, snapTime, splitNote, resizeNoteWithPush } from './utils/noteUtils';
import { sliceAudioBuffer } from './utils/audioUtils';

function App() {
  // --- Audio & Playback State ---
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Selection: [start, end]
  const [selectionRange, setSelectionRange] = useState<[number, number] | null>(null);

  // --- Analysis & History via Hook ---
  // History stores { pitchData, notes }
  const { 
    state: analysis, 
    commit: commitHistory, 
    undo, 
    redo, 
    reset: resetHistory, 
    canUndo, 
    canRedo 
  } = useUndoRedo<{pitchData: PitchFrame[], notes: Note[]}>({ pitchData: [], notes: [] });

  // Separate loading state (not part of history)
  const [analysisStatus, setAnalysisStatus] = useState({ isAnalyzing: false, progress: 0 });
  const [isRecalculating, setIsRecalculating] = useState(false);

  // Correction Mode State
  const [showCandidates, setShowCandidates] = useState(false);

  // --- Spectrogram State ---
  const [spectrogramData, setSpectrogramData] = useState<SpectrogramData | null>(null);
  const [showSpectrogram, setShowSpectrogram] = useState(false);

  // --- Visual Visibility State ---
  const [showPitch, setShowPitch] = useState(true);
  const [showNotes, setShowNotes] = useState(true);

  // --- Mixer State ---
  const [mixerState, setMixerState] = useState<MixerState>({
    originalEnabled: true, originalVolume: 1.0,
    pitchEnabled: true, pitchVolume: 0.6,
    notesEnabled: true, notesVolume: 0.6
  });

  // --- View State ---
  const [zoom, setZoom] = useState(100); 
  const [viewStartTime, setViewStartTime] = useState(0); 
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  
  // --- Modals ---
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalConfig, setSaveModalConfig] = useState<{content: string, defaultName: string, type: string} | null>(null);
  const [saveFileNameInput, setSaveFileNameInput] = useState("");
  const [locateModalOpen, setLocateModalOpen] = useState(false);
  const [pendingProjectData, setPendingProjectData] = useState<any | null>(null);
  const [projectHandle, setProjectHandle] = useState<any | null>(null);
  
  const animationFrameRef = useRef<number | null>(null);
  const fileLocateInputRef = useRef<HTMLInputElement>(null);

  // State Ref for Animation Loop stability
  const stateRef = useRef({
    isPlaying, isLooping, selectionRange, duration, audioBuffer, 
    pitchData: analysis.pitchData, notes: analysis.notes, 
    viewportWidth, zoom, currentTime, fileName, playbackSpeed, viewStartTime
  });

  useLayoutEffect(() => {
    stateRef.current = {
      isPlaying, isLooping, selectionRange, duration, audioBuffer,
      pitchData: analysis.pitchData, notes: analysis.notes,
      viewportWidth, zoom, currentTime, fileName, playbackSpeed, viewStartTime
    };
  }, [isPlaying, isLooping, selectionRange, duration, audioBuffer, analysis, viewportWidth, zoom, currentTime, fileName, playbackSpeed, viewStartTime]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    audioService.updateMixer(mixerState);
  }, [mixerState]);

  // --- Animation Loop ---
  const updateLoop = useCallback(() => {
    const state = stateRef.current;
    if (!state.isPlaying) return;

    const time = audioService.getCurrentTime();
    
    // Check Loop
    if (state.isLooping && state.selectionRange) {
      if (time >= state.selectionRange[1]) {
        const loopDuration = state.selectionRange[1] - state.selectionRange[0];
        audioService.stop(); 
        try {
            audioService.play(
                state.audioBuffer!, 
                state.pitchData, 
                state.notes, 
                state.selectionRange[0], 
                loopDuration, 
                state.playbackSpeed // Pass speed
            );
        } catch(e) { console.error("Loop restart failed", e); }
        
        setCurrentTime(state.selectionRange[0]);
        // Center view on loop start
        const viewDuration = state.viewportWidth / state.zoom;
        setViewStartTime(Math.max(0, state.selectionRange[0] - viewDuration / 2));
        
        animationFrameRef.current = requestAnimationFrame(updateLoop);
        return;
      }
    }

    // Check End
    if (time >= state.duration && state.duration > 0) {
      setIsPlaying(false);
      audioService.stop();
      setCurrentTime(state.isLooping && !state.selectionRange ? 0 : state.duration);
    } else {
      setCurrentTime(time);
      // Continuous View Centering
      const viewDuration = state.viewportWidth / state.zoom;
      setViewStartTime(Math.max(0, time - viewDuration / 2));
      animationFrameRef.current = requestAnimationFrame(updateLoop);
    }
  }, []);

  useEffect(() => {
    if (isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(updateLoop);
    } else {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
    return () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
  }, [isPlaying, updateLoop]);


  // --- Logic Handlers ---

  const runPitchAnalysis = async (buffer: AudioBuffer) => {
    setAnalysisStatus({ isAnalyzing: true, progress: 0 });
    try {
      const channelData = buffer.getChannelData(0);
      const frames = await extractPitch(channelData, buffer.sampleRate, (p) => {
        setAnalysisStatus(prev => ({ ...prev, progress: p }));
      });
      setAnalysisStatus({ isAnalyzing: false, progress: 1 });
      resetHistory({ pitchData: frames, notes: [] });

      // Trigger Spectrogram generation in background
      generateSpectrogram(buffer).then(data => {
          setSpectrogramData(data);
      }).catch(e => console.error("Spectrogram generation failed", e));

    } catch (e) {
      console.error(e);
      setAnalysisStatus({ isAnalyzing: false, progress: 0 });
      alert("Analysis failed.");
    }
  };

  const loadAudio = async (file: File) => {
      try {
        const buffer = await audioService.decodeAudio(file);
        setAudioBuffer(buffer);
        setDuration(buffer.duration);
        setFileName(file.name);
        setCurrentTime(0);
        setViewStartTime(0);
        setSelectionRange(null);
        setSpectrogramData(null); // Reset spectrogram
        audioService.stop();
        setIsPlaying(false);
        setProjectHandle(null); // Reset project handle on new audio load
        return buffer;
      } catch (err) {
        console.error(err);
        alert("Failed to load audio file.");
        return null;
      }
  };

  const handleFileSelect = useCallback(async (file: File) => {
    if (file) {
      const buffer = await loadAudio(file);
      if (buffer) {
          setAnalysisStatus({ isAnalyzing: false, progress: 0 });
          resetHistory({ pitchData: [], notes: [] });
          runPitchAnalysis(buffer);
      }
    }
  }, [resetHistory]);

  const handleLocateAudio = useCallback(async (file: File) => {
     if (!file || !pendingProjectData) return;
     const buffer = await loadAudio(file);
     if (buffer) {
         applyProjectData(pendingProjectData, buffer);
         setPendingProjectData(null);
         setLocateModalOpen(false);
         
         // Trigger Spectrogram generation for located audio
         generateSpectrogram(buffer).then(data => {
             setSpectrogramData(data);
         }).catch(e => console.error("Spectrogram generation failed", e));
     }
  }, [pendingProjectData]);

  const handleSelectionChange = useCallback((range: [number, number] | null) => {
    if (range && audioBuffer) {
        const sr = audioBuffer.sampleRate;
        setSelectionRange([snapTime(range[0], sr), snapTime(range[1], sr)]);
        setIsLooping(true);
    } else {
        setSelectionRange(range);
        if (!range) setIsLooping(false);
    }
  }, [audioBuffer]);

  // --- Playback Controls ---
  const handlePlayPause = useCallback(() => {
    const state = stateRef.current;
    if (!state.audioBuffer) return;

    if (state.isPlaying) {
      audioService.stop();
      setIsPlaying(false);
    } else {
      let startTime = state.currentTime;
      if (Math.abs(state.duration - startTime) < 0.1) startTime = 0;

      let playDuration = undefined;
      if (state.isLooping && state.selectionRange) {
        const [start, end] = state.selectionRange;
        if (state.currentTime < start || state.currentTime >= end) startTime = start;
        playDuration = end - startTime;
      } else if (state.isLooping && !state.selectionRange) {
         playDuration = state.duration - startTime;
      }

      // Jump view
      const viewDuration = state.viewportWidth / state.zoom;
      setViewStartTime(Math.max(0, startTime - viewDuration / 2));

      try {
        audioService.play(
            state.audioBuffer, 
            state.pitchData, 
            state.notes, 
            startTime, 
            playDuration, 
            state.playbackSpeed // Use current speed
        );
        setCurrentTime(startTime); 
        setIsPlaying(true);
      } catch (e) {
        console.error("Playback failed", e);
        setIsPlaying(false);
      }
    }
  }, []);

  const handleStop = useCallback(() => {
    const state = stateRef.current;
    if (!state.audioBuffer) return;
    audioService.stop();
    setIsPlaying(false);
    setCurrentTime(state.isLooping && state.selectionRange ? state.selectionRange[0] : 0);
  }, []);

  const handleSeek = useCallback((time: number) => {
    const state = stateRef.current;
    if (!state.audioBuffer) return;
    
    const sr = state.audioBuffer.sampleRate;
    let target = snapTime(Math.max(0, Math.min(time, state.duration)), sr);

    if (state.isPlaying) {
      audioService.stop();
      let playDuration = undefined;
      if (state.isLooping && state.selectionRange) {
          if (target >= state.selectionRange[0] && target < state.selectionRange[1]) {
              playDuration = state.selectionRange[1] - target;
          }
      }
      try {
        audioService.play(
            state.audioBuffer, 
            state.pitchData, 
            state.notes, 
            target, 
            playDuration,
            state.playbackSpeed
        );
      } catch (e) { console.error(e); setIsPlaying(false); }
    } 
    setCurrentTime(target);
  }, []);

  const handleRewind = useCallback(() => {
    const state = stateRef.current;
    if (state.isLooping && state.selectionRange) handleSeek(state.selectionRange[0]);
    else handleSeek(0);
  }, [handleSeek]);

  const handleSpeedChange = useCallback((speed: number) => {
    const state = stateRef.current;
    setPlaybackSpeed(speed);
    
    // If playing, restart with new speed
    if (state.isPlaying && state.audioBuffer) {
        audioService.stop();
        
        let playDuration = undefined;
        let startTime = state.currentTime;
        
        if (state.isLooping && state.selectionRange) {
            playDuration = state.selectionRange[1] - startTime;
        }

        try {
            audioService.play(state.audioBuffer, state.pitchData, state.notes, startTime, playDuration, speed);
            setIsPlaying(true);
        } catch(e) { console.error(e); setIsPlaying(false); }
    }
  }, []);

  const handleExtractPitch = async () => {
    if (!audioBuffer) return;
    runPitchAnalysis(audioBuffer);
  };

  // --- Recalculate Logic ---
  const handleRecalculateCandidates = async () => {
    if (!audioBuffer || !selectionRange) return;
    const [start, end] = selectionRange;
    setIsRecalculating(true);
    try {
        const PADDING = 4096;
        const result = sliceAudioBuffer(audioBuffer, start, end, PADDING);
        
        if (!result) {
            setIsRecalculating(false);
            return;
        }

        const { slice, offset } = result;
        const sr = audioBuffer.sampleRate;
        
        const newFrames = await extractPitch(slice, sr, () => {}, { threshold: 0.95, rmsThreshold: 0 });

        if (!newFrames || newFrames.length === 0) {
            setIsRecalculating(false);
            return;
        }

        const filtered = analysis.pitchData.filter(f => f.timestamp < start || f.timestamp > end);
        
        const validNew = newFrames
            .map(f => ({ ...f, timestamp: f.timestamp + offset }))
            .filter(f => f.timestamp >= start && f.timestamp <= end);

        commitHistory({ pitchData: [...filtered, ...validNew].sort((a, b) => a.timestamp - b.timestamp), notes: analysis.notes });
        setShowCandidates(true);
    } catch (e) { console.error(e); } finally { setIsRecalculating(false); }
  };

  // --- Save / Export Handlers ---
  const downloadFile = (content: string, name: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 250);
  };

  const saveFileAs = useCallback(async (content: string, defaultName: string, type: string, ext: string, desc: string, forceNew = false) => {
      // 1. If we have a project handle and we are Saving (not Save As), overwrite it
      if (!forceNew && projectHandle && type === 'application/json' && 'showSaveFilePicker' in window) {
           try {
               const writable = await projectHandle.createWritable();
               await writable.write(content);
               await writable.close();
               return;
           } catch(err) { console.error("Overwrite failed", err); /* Fallback */ }
      }

      // 2. Use Save As Picker if available
      if ('showSaveFilePicker' in window) {
          try {
              // @ts-ignore
              const handle = await window.showSaveFilePicker({ suggestedName: defaultName, types: [{ description: desc, accept: { [type]: [ext] } }] });
              // Store handle for future saves if this is a project file
              if (type === 'application/json') setProjectHandle(handle);

              const writable = await handle.createWritable();
              await writable.write(content);
              await writable.close();
              return;
          } catch (err: any) { if (err.name !== 'AbortError') console.error(err); else return; }
      }

      // 3. Fallback to Modal for Firefox/Safari
      setSaveFileNameInput(defaultName);
      setSaveModalConfig({ content, defaultName, type });
      setSaveModalOpen(true);
  }, [projectHandle]);

  const handleSaveModalConfirm = () => {
      if (saveModalConfig) {
          let name = saveFileNameInput.trim() || saveModalConfig.defaultName;
          downloadFile(saveModalConfig.content, name, saveModalConfig.type);
      }
      setSaveModalOpen(false);
      setSaveModalConfig(null);
  };

  const handleSaveProject = useCallback(async () => {
    if(!audioBuffer) { alert("No project data."); return; }
    try {
        const viewState = { zoom, viewStartTime, currentTime, selectionRange };
        const settings = { isLooping, playbackSpeed, showSpectrogram, showPitch, showNotes, mixerState };
        const json = generateProjectJSON(fileName || "project", audioBuffer.sampleRate, analysis.pitchData, analysis.notes, viewState, settings);
        const name = (fileName || "project").replace(/\.[^/.]+$/, "");
        await saveFileAs(json, `${name}.tonyweb`, 'application/json', '.tonyweb', 'Tony Web Project');
    } catch(e) { console.error(e); alert("Failed to save."); }
  }, [audioBuffer, fileName, analysis, saveFileAs, zoom, viewStartTime, currentTime, selectionRange, isLooping, playbackSpeed, showSpectrogram, showPitch, showNotes, mixerState]);

  const handleSaveAsProject = useCallback(async () => {
    if(!audioBuffer) { alert("No project data."); return; }
    try {
        const viewState = { zoom, viewStartTime, currentTime, selectionRange };
        const settings = { isLooping, playbackSpeed, showSpectrogram, showPitch, showNotes, mixerState };
        const json = generateProjectJSON(fileName || "project", audioBuffer.sampleRate, analysis.pitchData, analysis.notes, viewState, settings);
        const name = (fileName || "project").replace(/\.[^/.]+$/, "");
        await saveFileAs(json, `${name}.tonyweb`, 'application/json', '.tonyweb', 'Tony Web Project', true);
    } catch(e) { console.error(e); alert("Failed to save."); }
  }, [audioBuffer, fileName, analysis, saveFileAs, zoom, viewStartTime, currentTime, selectionRange, isLooping, playbackSpeed, showSpectrogram, showPitch, showNotes, mixerState]);

  const handleExportPitchCSV = useCallback(async () => {
    const csv = generatePitchCSV(analysis.pitchData);
    const name = (fileName || "track").replace(/\.[^/.]+$/, "");
    await saveFileAs(csv, `${name}_pitch.csv`, 'text/csv', '.csv', 'Pitch CSV');
  }, [analysis.pitchData, fileName, saveFileAs]);

  const handleExportNotesCSV = useCallback(async () => {
    const csv = generateNotesCSV(analysis.notes);
    const name = (fileName || "track").replace(/\.[^/.]+$/, "");
    await saveFileAs(csv, `${name}_notes.csv`, 'text/csv', '.csv', 'Notes CSV');
  }, [analysis.notes, fileName, saveFileAs]);

  const handleExportSVL = useCallback(async () => {
    if(!audioBuffer) return;
    const xml = generateSVL(analysis.pitchData, analysis.notes, audioBuffer.sampleRate, fileName || "layer");
    const name = (fileName || "track").replace(/\.[^/.]+$/, "");
    await saveFileAs(xml, `${name}.svl`, 'text/xml', '.svl', 'Sonic Visualiser Layer');
  }, [audioBuffer, analysis, fileName, saveFileAs]);

  // --- Load / Import ---
  const applyProjectData = useCallback((data: any, buffer: AudioBuffer) => {
    const sr = buffer.sampleRate;
    const snappedPitch = data.pitchData.map((f: PitchFrame) => ({...f, timestamp: snapTime(f.timestamp, sr)}));
    const snappedNotes = data.notes.map((n: Note) => ({...n, start: snapTime(n.start, sr), end: snapTime(n.end, sr)}));
    resetHistory({ pitchData: snappedPitch, notes: snappedNotes });
    
    // Restore View State
    if (data.viewState) {
        if (data.viewState.zoom) setZoom(data.viewState.zoom);
        if (data.viewState.viewStartTime !== undefined) setViewStartTime(data.viewState.viewStartTime);
        if (data.viewState.currentTime !== undefined) setCurrentTime(data.viewState.currentTime);
        if (data.viewState.selectionRange) setSelectionRange(data.viewState.selectionRange);
    }

    // Restore Settings
    if (data.settings) {
        if (data.settings.isLooping !== undefined) setIsLooping(data.settings.isLooping);
        if (data.settings.playbackSpeed !== undefined) setPlaybackSpeed(data.settings.playbackSpeed);
        if (data.settings.showSpectrogram !== undefined) setShowSpectrogram(data.settings.showSpectrogram);
        if (data.settings.showPitch !== undefined) setShowPitch(data.settings.showPitch);
        if (data.settings.showNotes !== undefined) setShowNotes(data.settings.showNotes);
        if (data.settings.mixerState) setMixerState(data.settings.mixerState);
    }

  }, [resetHistory]);

  const handleLoadProject = async (file: File) => {
    const data = parseProjectJSON(await file.text());
    if (!data) { alert("Invalid project file"); return; }
    if (audioBuffer && fileName === data.fileName) applyProjectData(data, audioBuffer);
    else { setPendingProjectData(data); setLocateModalOpen(true); }
  };

  const handleImportPitch = useCallback(async (file: File) => {
    let frames = parseCSV(await file.text(), 'pitch');
    if (frames.length > 0 && audioBuffer) {
        const sr = audioBuffer.sampleRate;
        frames = frames.map((f: any) => ({...f, timestamp: snapTime(f.timestamp, sr)}));
    }
    if (frames.length > 0) commitHistory({ ...analysis, pitchData: frames });
  }, [audioBuffer, analysis, commitHistory]);

  const handleImportNotes = useCallback(async (file: File) => {
    let notes = parseCSV(await file.text(), 'note');
    if (notes.length > 0 && audioBuffer) {
        const sr = audioBuffer.sampleRate;
        notes = notes.map((n: any) => ({...n, start: snapTime(n.start, sr), end: snapTime(n.end, sr)}));
    }
    if (notes.length > 0) commitHistory({ ...analysis, notes });
  }, [audioBuffer, analysis, commitHistory]);

  // --- Note & Pitch Operations ---
  const handlePitchCorrection = useCallback((direction: 'up' | 'down') => {
    if (!selectionRange) return;
    const [start, end] = selectionRange;
    let hasChanged = false;
    const newData = analysis.pitchData.map(frame => {
        if (frame.timestamp >= start && frame.timestamp <= end && frame.candidates?.length) {
            const sorted = [...frame.candidates].sort((a, b) => a.frequency - b.frequency);
            const currIdx = sorted.findIndex(c => Math.abs(c.frequency - frame.frequency) < 0.1);
            let newIdx = currIdx;
            
            if (direction === 'up') {
                if (frame.frequency === 0) {
                    const first = sorted.findIndex(c => c.frequency > 0);
                    if (first !== -1) newIdx = first;
                } else if (currIdx < sorted.length - 1) newIdx++;
            } else if (currIdx > 0) newIdx--;

            if (newIdx !== -1 && newIdx !== currIdx) {
                hasChanged = true;
                const sel = sorted[newIdx];
                return { ...frame, frequency: sel.frequency, probability: sel.probability, hasPitch: sel.frequency > 0 };
            }
        }
        return frame;
    });
    if (hasChanged) commitHistory({ ...analysis, pitchData: newData });
  }, [selectionRange, analysis, commitHistory]);

  const handleDeletePitch = useCallback(() => {
    if (!selectionRange) return;
    const [start, end] = selectionRange;
    let hasChanged = false;
    const newData = analysis.pitchData.map(f => {
        if (f.timestamp >= start && f.timestamp <= end && (f.hasPitch || f.frequency > 0)) {
            hasChanged = true;
            return { ...f, frequency: 0, hasPitch: false };
        }
        return f;
    });
    if (hasChanged) commitHistory({ ...analysis, pitchData: newData });
  }, [selectionRange, analysis, commitHistory]);

  const handleCreateNote = useCallback(() => {
    if (!selectionRange) return;
    const [start, end] = selectionRange;
    const filteredNotes = analysis.notes.filter(n => !((n.start + n.end)/2 >= start && (n.start + n.end)/2 <= end));
    const frames = analysis.pitchData.filter(f => f.timestamp >= start && f.timestamp <= end);
    const pitch = calculateMedianPitch(frames);
    
    if (pitch > 0) {
        const newNote: Note = { id: crypto.randomUUID(), start, end, pitch, state: 'default' };
        commitHistory({ ...analysis, notes: [...filteredNotes, newNote] });
    } else if (filteredNotes.length !== analysis.notes.length) {
        commitHistory({ ...analysis, notes: filteredNotes });
    }
  }, [selectionRange, analysis, commitHistory]);

  const handleDeleteNotes = useCallback(() => {
    if (!selectionRange) return;
    const [start, end] = selectionRange;
    const newNotes = analysis.notes.filter(n => !((n.start + n.end)/2 >= start && (n.start + n.end)/2 <= end));
    if (newNotes.length !== analysis.notes.length) commitHistory({ ...analysis, notes: newNotes });
  }, [selectionRange, analysis, commitHistory]);

  const handleSplitNote = useCallback(() => {
    let splitTime = audioBuffer ? snapTime(currentTime, audioBuffer.sampleRate) : currentTime;
    const target = analysis.notes.find(n => splitTime > n.start + 0.01 && splitTime < n.end - 0.01);
    if (!target) return;

    const split = splitNote(target, splitTime, analysis.pitchData);
    if (split) {
        const others = analysis.notes.filter(n => n.id !== target.id);
        commitHistory({ ...analysis, notes: [...others, ...split].sort((a, b) => a.start - b.start) });
    }
  }, [currentTime, analysis, audioBuffer, commitHistory]);

  const handleNoteResize = useCallback((id: string, start: number, end: number) => {
    const newNotes = resizeNoteWithPush(analysis.notes, id, start, end, analysis.pitchData);
    commitHistory({ ...analysis, notes: newNotes });
  }, [analysis, commitHistory]);

  // --- Zoom ---
  const setCenteredZoom = useCallback((newZoom: number) => {
     const viewDur = window.innerWidth / zoom;
     const center = viewStartTime + viewDur / 2;
     const newDur = window.innerWidth / newZoom;
     setZoom(newZoom);
     setViewStartTime(Math.max(0, center - newDur / 2));
  }, [zoom, viewStartTime]);

  const handleZoomWheel = useCallback((dY: number, mTime: number) => {
    const factor = dY > 0 ? 0.8 : 1.25;
    const newZoom = Math.max(10, Math.min(1000, zoom * factor));
    const ratio = zoom / newZoom;
    setViewStartTime(Math.max(0, mTime - (mTime - viewStartTime) * ratio));
    setZoom(newZoom);
  }, [zoom, viewStartTime]);

  // --- Initialize Keyboard Shortcuts ---
  useKeyboardShortcuts({
    onPlayPause: handlePlayPause,
    onDeleteNotes: handleDeleteNotes,
    onCreateNote: handleCreateNote,
    onSplitNote: handleSplitNote,
    onToggleCandidates: () => setShowCandidates(p => !p),
    onSaveProject: handleSaveProject,
    onUndo: undo,
    onRedo: redo,
    onPitchCorrection: handlePitchCorrection,
    onSeek: handleSeek,
    currentTime: currentTime
  });

  return (
    <div className="flex flex-col h-screen w-screen bg-white text-gray-900 font-sans overflow-hidden">
      <Controls 
        isPlaying={isPlaying} isLooping={isLooping}
        onPlayPause={handlePlayPause} onStop={handleStop} onRewind={handleRewind}
        onToggleLoop={() => setIsLooping(!isLooping)}
        onZoomIn={() => setCenteredZoom(Math.min(zoom * 1.5, 1000))}
        onZoomOut={() => setCenteredZoom(Math.max(zoom / 1.5, 10))}
        onFileLoad={handleFileSelect} onExtractPitch={handleExtractPitch}
        onSaveProject={handleSaveProject} onLoadProject={handleLoadProject}
        onExportPitchCSV={handleExportPitchCSV} onExportNotesCSV={handleExportNotesCSV} onExportSVL={handleExportSVL}
        onImportPitch={handleImportPitch} onImportNotes={handleImportNotes}
        isAnalyzing={analysisStatus.isAnalyzing} isRecalculating={isRecalculating}
        hasData={analysis.pitchData.length > 0} fileName={fileName}
        selectionActive={selectionRange !== null} showCandidates={showCandidates}
        onToggleCandidates={() => setShowCandidates(!showCandidates)}
        onShiftUp={() => handlePitchCorrection('up')} onShiftDown={() => handlePitchCorrection('down')}
        onRecalculateCandidates={handleRecalculateCandidates} onDeletePitch={handleDeletePitch}
        onCreateNote={handleCreateNote} onDeleteNote={handleDeleteNotes} onSplitNote={handleSplitNote}
        canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo}
      />

      {/* Save Modal */}
      {saveModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-white p-6 rounded-lg shadow-2xl w-96 border">
                  <h3 className="text-lg font-semibold mb-4">Save File</h3>
                  <input autoFocus type="text" className="w-full border rounded px-3 py-2 mb-6"
                      value={saveFileNameInput} onChange={(e) => setSaveFileNameInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveModalConfirm()}
                  />
                  <div className="flex justify-end gap-3">
                      <button onClick={() => setSaveModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded">Cancel</button>
                      <button onClick={handleSaveModalConfirm} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Download</button>
                  </div>
              </div>
          </div>
      )}

      {/* Locate Modal */}
      {locateModalOpen && pendingProjectData && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-white p-6 rounded-lg shadow-2xl w-[450px] border">
                  <h3 className="text-lg font-semibold mb-2">Locate Audio File</h3>
                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4 text-sm text-yellow-700">
                      Project references <strong>{pendingProjectData.fileName}</strong>.<br/>Please manually locate this file.
                  </div>
                  <div className="flex justify-end gap-3">
                      <button onClick={() => { setLocateModalOpen(false); setPendingProjectData(null); }} className="px-4 py-2 hover:bg-gray-100 rounded">Cancel</button>
                      <button onClick={() => fileLocateInputRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Locate File...</button>
                  </div>
                  <input ref={fileLocateInputRef} type="file" accept="audio/*" onChange={(e) => { if(e.target.files?.[0]) handleLocateAudio(e.target.files[0]); }} className="hidden" />
              </div>
          </div>
      )}

      {/* Main View */}
      <div className="flex-1 relative flex flex-col min-h-0 bg-white">
        {analysisStatus.isAnalyzing && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                <div className="bg-white p-6 rounded-lg shadow-xl border text-center">
                    <h3 className="text-xl font-semibold mb-2">Extracting Pitch...</h3>
                    <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600 transition-all" style={{ width: `${analysisStatus.progress * 100}%` }} />
                    </div>
                </div>
            </div>
        )}

        <PitchVisualizer 
          pitchData={analysis.pitchData} notes={analysis.notes}
          spectrogramData={spectrogramData} showSpectrogram={showSpectrogram}
          showPitch={showPitch} showNotes={showNotes}
          currentTime={currentTime} duration={duration} zoom={zoom}
          containerHeight={window.innerHeight - 64 - 64 - 56} 
          viewStartTime={viewStartTime} selectionRange={selectionRange}
          showCandidates={showCandidates} frameDuration={audioBuffer ? YIN_HOP_SIZE / audioBuffer.sampleRate : 0}
          onViewScroll={setViewStartTime} onSeek={handleSeek} onZoomWheel={handleZoomWheel}
          onSelectionChange={handleSelectionChange} onNoteResize={handleNoteResize}
        />
        
        {!fileName && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-gray-400 opacity-50">
                <div className="text-center"><p className="text-3xl font-bold">Tony Web</p><p>Load an audio file to begin</p></div>
            </div>
        )}
      </div>

      <div className="flex-none shadow-sm z-10 relative">
        <WaveformNavigator 
          audioBuffer={audioBuffer} currentTime={currentTime} duration={duration}
          onSeek={handleSeek} viewStartTime={viewStartTime}
          viewDuration={zoom > 0 ? viewportWidth / zoom : 0} onViewChange={setViewStartTime}
        />
      </div>

      <Mixer 
        mixerState={mixerState} 
        onUpdate={useCallback((u) => setMixerState(p => ({ ...p, ...u })), [])}
        showSpectrogram={showSpectrogram}
        onToggleSpectrogram={() => setShowSpectrogram(!showSpectrogram)}
        showPitch={showPitch} onTogglePitch={() => setShowPitch(!showPitch)}
        showNotes={showNotes} onToggleNotes={() => setShowNotes(!showNotes)}
        playbackSpeed={playbackSpeed}
        onPlaybackSpeedChange={handleSpeedChange}
      />
    </div>
  );
}

export default App;
