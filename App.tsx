
import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import Controls from './components/Controls';
import WaveformNavigator from './components/WaveformNavigator';
import PitchVisualizer from './components/PitchVisualizer';
import SegmentLanes, { SegmentRef } from './components/SegmentLanes';
import Mixer from './components/Mixer';
import { audioService } from './services/audioService';
import { extractPitch, YIN_HOP_SIZE } from './services/yin';
import { generateSpectrogram } from './services/spectrogram';
import { generateProjectJSON, generatePitchCSV, generateNotesCSV, generateSVL, parseProjectJSON, parseCSV } from './services/exportService';
import { MixerState, PitchFrame, Note, SpectrogramData, SegmentLayer } from './types';
import { generateSegmentsCSV, generateTextGrid, generateSegmentSVL, parseTextGrid, parseSegmentsCSV } from './services/segmentExport';
import { addSegment, createLayer, deleteSegment, splitSegment } from './utils/segmentUtils';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { calculateMedianPitch, snapTime, splitNote, resizeNoteWithPush, getNoteContextRange } from './utils/noteUtils';
import { sliceAudioBuffer } from './utils/audioUtils';
import { getArtifactDownloads, artifactFilename } from './utils/artifactDownloads';
import { clampViewStart, clampZoom, getMinZoom, wheelZoomFactor, followPlayhead } from './utils/viewUtils';
import { X } from 'lucide-react';

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

  // Note Selection (for Pitch Editing)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [pitchInputValue, setPitchInputValue] = useState("");

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
  } = useUndoRedo<{pitchData: PitchFrame[], notes: Note[], segmentLayers: SegmentLayer[]}>({ pitchData: [], notes: [], segmentLayers: [] });

  // Segment layers (lyrics, speakers, ...): which lane receives new segments, and the selected / edited segment
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<SegmentRef | null>(null);
  const [editingSegment, setEditingSegment] = useState<SegmentRef | null>(null);

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

  // Find Selected Note object
  const selectedNote = analysis.notes.find(n => n.id === selectedNoteId);

  useLayoutEffect(() => {
    stateRef.current = {
      isPlaying, isLooping, selectionRange, duration, audioBuffer,
      pitchData: analysis.pitchData, notes: analysis.notes,
      viewportWidth, zoom, currentTime, fileName, playbackSpeed, viewStartTime
    };
  }, [isPlaying, isLooping, selectionRange, duration, audioBuffer, analysis, viewportWidth, zoom, currentTime, fileName, playbackSpeed, viewStartTime]);

  // Keep zoom and view inside the audio whatever changed them (wheel, minimap, resize, load).
  useLayoutEffect(() => {
    if (duration <= 0) return;
    const z = clampZoom(zoom, viewportWidth, duration);
    if (z !== zoom) { setZoom(z); return; }
    const v = clampViewStart(viewStartTime, zoom, viewportWidth, duration);
    if (v !== viewStartTime) setViewStartTime(v);
  }, [zoom, viewStartTime, viewportWidth, duration]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    audioService.updateMixer(mixerState);
  }, [mixerState]);

  // Sync pitch input value when selected note pitch changes (drag or selection)
  useEffect(() => {
    if (selectedNote) {
        setPitchInputValue(selectedNote.pitch.toFixed(2));
    }
  }, [selectedNote?.pitch, selectedNote?.id]);

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
        // Keep loop start in view without jumping when it is already visible
        setViewStartTime(followPlayhead(state.selectionRange[0], state.viewStartTime, state.zoom, state.viewportWidth));
        
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
      // Page-turn follow: move the view only when the playhead leaves it
      const nextStart = followPlayhead(time, state.viewStartTime, state.zoom, state.viewportWidth);
      if (nextStart !== state.viewStartTime) {
        state.viewStartTime = clampViewStart(nextStart, state.zoom, state.viewportWidth, state.duration);
        setViewStartTime(state.viewStartTime);
      }
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

  const runPitchAnalysis = async (buffer: AudioBuffer, segmentLayers: SegmentLayer[] = []) => {
    setAnalysisStatus({ isAnalyzing: true, progress: 0 });
    try {
      const channelData = buffer.getChannelData(0);
      const frames = await extractPitch(channelData, buffer.sampleRate, (p) => {
        setAnalysisStatus(prev => ({ ...prev, progress: p }));
      });
      setAnalysisStatus({ isAnalyzing: false, progress: 1 });
      resetHistory({ pitchData: frames, notes: [], segmentLayers });

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
        setSelectedNoteId(null);
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
          resetHistory({ pitchData: [], notes: [], segmentLayers: [] });
          setActiveLayerId(null);
          setSelectedSegment(null);
          setEditingSegment(null);
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
        // If the user manually changes selection, we might want to clear selected note? 
        // For now keep it to allow complex editing, but could clear setSelectedNoteId(null);
    } else {
        setSelectionRange(range);
        if (!range) {
            setIsLooping(false);
            setSelectedNoteId(null); // Clear selected note on click outside
        }
    }
    setSelectedSegment(null);
  }, [audioBuffer]);

  // Helper to start playback using current state ref (avoids closure staleness)
  const playInternal = (state: typeof stateRef.current) => {
      if (!state.audioBuffer) return;
      
      let startTime = state.currentTime;
      if (Math.abs(state.duration - startTime) < 0.1) startTime = 0;

      let playDuration = undefined;
      if (state.isLooping && state.selectionRange) {
        const [start, end] = state.selectionRange;
        // If cursor is outside loop, jump to start
        if (startTime < start || startTime >= end) startTime = start;
        playDuration = end - startTime;
      } else if (state.isLooping && !state.selectionRange) {
         playDuration = state.duration - startTime;
      }

      // Bring the start point into view (no jump if it is already visible)
      setViewStartTime(followPlayhead(startTime, state.viewStartTime, state.zoom, state.viewportWidth));

      audioService.play(
          state.audioBuffer, 
          state.pitchData, 
          state.notes, 
          startTime, 
          playDuration, 
          state.playbackSpeed
      );
      
      // Update React state to reflect playing
      setCurrentTime(startTime); 
      setIsPlaying(true);
  };

  // --- Playback Controls ---
  const handlePlayPause = useCallback(() => {
    const state = stateRef.current;
    if (state.isPlaying) {
      audioService.stop();
      setIsPlaying(false);
    } else {
      try {
        playInternal(state);
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
    // Re-extracting pitch replaces notes but keeps segment layers
    runPitchAnalysis(audioBuffer, analysis.segmentLayers);
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

        commitHistory({ ...analysis, pitchData: [...filtered, ...validNew].sort((a, b) => a.timestamp - b.timestamp) });
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
      // 0. Inside a claude.ai artifact preview, save through the viewer
      const artifactDownloads = await getArtifactDownloads();
      if (artifactDownloads) {
          const filename = artifactFilename(defaultName);
          try {
              await artifactDownloads.save({ filename, data: new Blob([content]) });
              if (filename !== defaultName && !filename.endsWith('.json')) {
                  alert(`Saved as "${filename}". Remove the ".txt" ending to open it in other programs.`);
              }
          } catch (err: any) {
              if (err?.code !== 'declined') alert(`Could not save the file (${err?.code ?? err}).`);
          }
          return;
      }

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
        const json = generateProjectJSON(fileName || "project", audioBuffer.sampleRate, analysis.pitchData, analysis.notes, viewState, settings, analysis.segmentLayers);
        const name = (fileName || "project").replace(/\.[^/.]+$/, "");
        await saveFileAs(json, `${name}.tonyweb`, 'application/json', '.tonyweb', 'Tony Web Project');
    } catch(e) { console.error(e); alert("Failed to save."); }
  }, [audioBuffer, fileName, analysis, saveFileAs, zoom, viewStartTime, currentTime, selectionRange, isLooping, playbackSpeed, showSpectrogram, showPitch, showNotes, mixerState]);

  const handleSaveAsProject = useCallback(async () => {
    if(!audioBuffer) { alert("No project data."); return; }
    try {
        const viewState = { zoom, viewStartTime, currentTime, selectionRange };
        const settings = { isLooping, playbackSpeed, showSpectrogram, showPitch, showNotes, mixerState };
        const json = generateProjectJSON(fileName || "project", audioBuffer.sampleRate, analysis.pitchData, analysis.notes, viewState, settings, analysis.segmentLayers);
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
    const segmentLayers: SegmentLayer[] = Array.isArray(data.segmentLayers) ? data.segmentLayers : [];
    resetHistory({ pitchData: snappedPitch, notes: snappedNotes, segmentLayers });
    setActiveLayerId(segmentLayers[0]?.id ?? null);
    setSelectedSegment(null);
    setEditingSegment(null);
    
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

  const handleNoteResize = useCallback((id: string, start: number, end: number, detach = false) => {
    const newNotes = resizeNoteWithPush(analysis.notes, id, start, end, analysis.pitchData, duration, detach);
    commitHistory({ ...analysis, notes: newNotes });
  }, [analysis, commitHistory, duration]);

  // --- Note & Pitch Operations (Double Click Workflow) ---
  const handleNoteSelect = useCallback((noteId: string) => {
     const note = analysis.notes.find(n => n.id === noteId);
     if (note && audioBuffer) {
        // 1. Calculate Context Selection (e.g. Note + 2 seconds or neighboring notes)
        const range = getNoteContextRange(note, 2.0); // 2 seconds context
        setSelectionRange(range);
        setIsLooping(true);
        // 2. Lock Note
        setSelectedNoteId(noteId);
        // 3. Move playhead to start of selection
        setCurrentTime(range[0]);
     }
  }, [analysis.notes, audioBuffer]);

  const handleNotePitchChange = useCallback((id: string, newPitch: number) => {
      const updatedNotes = analysis.notes.map(n => n.id === id ? { ...n, pitch: newPitch } : n);
      commitHistory({ ...analysis, notes: updatedNotes });
  }, [analysis, commitHistory]);

  const handlePitchDragEnd = useCallback((id: string, newPitch: number) => {
      // 1. Synchronously update the note list for playback
      // Use the optimistically updated pitch since React state (from commitHistory)
      // might not have propagated yet.
      const optimisticNotes = stateRef.current.notes.map(n => n.id === id ? { ...n, pitch: newPitch } : n);
      
      const optimisticState = { ...stateRef.current, notes: optimisticNotes };

      // 2. Restart Playback Synchronously
      if (optimisticState.audioBuffer) {
          audioService.stop();
          playInternal(optimisticState);
      }

      // 3. Commit to History (Async React update)
      // This ensures the visual state becomes permanent
      handleNotePitchChange(id, newPitch);

  }, [handleNotePitchChange]);

  const handlePitchInputCommit = () => {
    if (selectedNoteId && pitchInputValue) {
        const val = parseFloat(pitchInputValue);
        if (!isNaN(val) && val > 0) {
            handlePitchDragEnd(selectedNoteId, val); // Use drag end logic to trigger play
        }
    }
  };

  // --- Segment Layers ---
  const handleSegmentLayersChange = useCallback((segmentLayers: SegmentLayer[]) => {
    commitHistory({ ...analysis, segmentLayers });
  }, [analysis, commitHistory]);

  const handleAddLayer = useCallback(() => {
    const layer = createLayer(analysis.segmentLayers);
    commitHistory({ ...analysis, segmentLayers: [...analysis.segmentLayers, layer] });
    setActiveLayerId(layer.id);
  }, [analysis, commitHistory]);

  // A segment being drawn or resized shows as the time selection in the pitch view
  const handlePreviewSelection = useCallback((range: [number, number]) => {
    setSelectedNoteId(null);
    setSelectionRange(range);
    setIsLooping(true);
  }, []);

  // Selecting a segment selects its time range, so Space loops it (handy while transcribing)
  const handleSelectSegment = useCallback((ref: SegmentRef | null) => {
    setSelectedSegment(ref);
    if (!ref) return;
    setActiveLayerId(ref.layerId);
    const seg = analysis.segmentLayers.find(l => l.id === ref.layerId)?.segments.find(s => s.id === ref.segmentId);
    if (seg) {
        setSelectedNoteId(null);
        setSelectionRange([seg.start, seg.end]);
        setIsLooping(true);
        if (!stateRef.current.isPlaying) setCurrentTime(seg.start);
    }
  }, [analysis.segmentLayers]);

  const getSelectedSegment = () => {
    if (!selectedSegment) return null;
    const layer = analysis.segmentLayers.find(l => l.id === selectedSegment.layerId);
    const segment = layer?.segments.find(s => s.id === selectedSegment.segmentId);
    return layer && segment ? { layer, segment } : null;
  };

  // Enter: label the selected segment, or turn the time selection into a segment in the active layer
  const handleSegmentEnter = useCallback(() => {
    if (getSelectedSegment()) { setEditingSegment(selectedSegment); return; }
    if (!selectionRange || !duration) return;
    let layers = analysis.segmentLayers;
    let layer = layers.find(l => l.id === activeLayerId) ?? layers[0];
    if (!layer) {
        layer = createLayer(layers);
        layers = [...layers, layer];
    }
    const result = addSegment(layer, selectionRange[0], selectionRange[1], duration);
    if (!result) return;
    commitHistory({ ...analysis, segmentLayers: layers.map(l => l.id === layer!.id ? result.layer : l) });
    const ref = { layerId: layer.id, segmentId: result.segment.id };
    setActiveLayerId(layer.id);
    setSelectedSegment(ref);
    setEditingSegment(ref);
  }, [selectedSegment, selectionRange, duration, analysis, activeLayerId, commitHistory]);

  const handleDelete = useCallback(() => {
    const sel = getSelectedSegment();
    if (sel) {
        commitHistory({ ...analysis, segmentLayers: analysis.segmentLayers.map(l => l.id === sel.layer.id ? deleteSegment(l, sel.segment.id) : l) });
        setSelectedSegment(null);
        return;
    }
    handleDeleteNotes();
  }, [selectedSegment, analysis, commitHistory, handleDeleteNotes]);

  const handleSplit = useCallback(() => {
    const sel = getSelectedSegment();
    if (sel && currentTime > sel.segment.start && currentTime < sel.segment.end) {
        const layer = splitSegment(sel.layer, sel.segment.id, currentTime);
        if (layer) commitHistory({ ...analysis, segmentLayers: analysis.segmentLayers.map(l => l.id === layer.id ? layer : l) });
        return;
    }
    handleSplitNote();
  }, [selectedSegment, currentTime, analysis, commitHistory, handleSplitNote]);

  const handleExportSegmentsCSV = useCallback(async () => {
    if (analysis.segmentLayers.length === 0) { alert("No segment layers to export."); return; }
    const name = (fileName || "track").replace(/\.[^/.]+$/, "");
    await saveFileAs(generateSegmentsCSV(analysis.segmentLayers), `${name}_segments.csv`, 'text/csv', '.csv', 'Segments CSV');
  }, [analysis.segmentLayers, fileName, saveFileAs]);

  const handleExportTextGrid = useCallback(async () => {
    if (analysis.segmentLayers.length === 0) { alert("No segment layers to export."); return; }
    const name = (fileName || "track").replace(/\.[^/.]+$/, "");
    await saveFileAs(generateTextGrid(analysis.segmentLayers, duration), `${name}.TextGrid`, 'text/plain', '.TextGrid', 'Praat TextGrid');
  }, [analysis.segmentLayers, duration, fileName, saveFileAs]);

  const handleExportSegmentSVL = useCallback(async () => {
    if (!audioBuffer) return;
    const layer = analysis.segmentLayers.find(l => l.id === activeLayerId) ?? analysis.segmentLayers[0];
    if (!layer) { alert("No segment layers to export."); return; }
    const name = (fileName || "track").replace(/\.[^/.]+$/, "");
    const layerName = layer.name.replace(/[^\w-]+/g, '_');
    await saveFileAs(generateSegmentSVL(layer, audioBuffer.sampleRate), `${name}_${layerName}.svl`, 'text/xml', '.svl', 'Sonic Visualiser Layer');
  }, [audioBuffer, analysis.segmentLayers, activeLayerId, fileName, saveFileAs]);

  const handleImportSegments = useCallback(async (file: File) => {
    const text = await file.text();
    let imported: SegmentLayer[] = [];
    try {
        imported = /\.textgrid$/i.test(file.name) || text.includes('ooTextFile')
            ? parseTextGrid(text)
            : parseSegmentsCSV(text, file.name.replace(/\.[^/.]+$/, ""));
    } catch (e) {
        console.error(e);
        alert("Could not read segments from this file.");
        return;
    }
    if (imported.length === 0) { alert("No segments found in this file."); return; }
    // Recolour so imported layers don't repeat the colours of existing ones
    const all = [...analysis.segmentLayers];
    imported.forEach(l => all.push({ ...createLayer(all, l.name), segments: l.segments }));
    commitHistory({ ...analysis, segmentLayers: all });
    setActiveLayerId(all[analysis.segmentLayers.length].id);
  }, [analysis, commitHistory]);

  // --- Zoom ---
  const setCenteredZoom = useCallback((requestedZoom: number) => {
     const newZoom = clampZoom(requestedZoom, viewportWidth, duration);
     const viewDur = viewportWidth / zoom;
     const center = viewStartTime + viewDur / 2;
     const newDur = viewportWidth / newZoom;
     setZoom(newZoom);
     setViewStartTime(clampViewStart(center - newDur / 2, newZoom, viewportWidth, duration));
  }, [zoom, viewStartTime, viewportWidth, duration]);

  const handleZoomWheel = useCallback((deltaPixels: number, mTime: number) => {
    const newZoom = clampZoom(zoom * wheelZoomFactor(deltaPixels), viewportWidth, duration);
    const ratio = zoom / newZoom;
    setViewStartTime(clampViewStart(mTime - (mTime - viewStartTime) * ratio, newZoom, viewportWidth, duration));
    setZoom(newZoom);
  }, [zoom, viewStartTime, viewportWidth, duration]);

  // Show the whole file
  const handleFitView = useCallback(() => {
    setZoom(getMinZoom(viewportWidth, duration));
    setViewStartTime(0);
  }, [viewportWidth, duration]);

  // --- Initialize Keyboard Shortcuts ---
  useKeyboardShortcuts({
    onPlayPause: handlePlayPause,
    onDeleteNotes: handleDelete,
    onCreateNote: handleCreateNote,
    onSplitNote: handleSplit,
    onSegmentEnter: handleSegmentEnter,
    onToggleCandidates: () => setShowCandidates(p => !p),
    onSaveProject: handleSaveProject,
    onUndo: undo,
    onRedo: redo,
    onPitchCorrection: handlePitchCorrection,
    onSeek: handleSeek,
    onFitView: handleFitView,
    currentTime: currentTime
  });

  // Segment boundaries snap to note boundaries and the time selection
  const snapTimes = useMemo(() => {
    const times: number[] = [];
    analysis.notes.forEach(n => times.push(n.start, n.end));
    if (selectionRange) times.push(selectionRange[0], selectionRange[1]);
    return times;
  }, [analysis.notes, selectionRange]);

  return (
    <div className="flex flex-col h-screen w-screen bg-white text-gray-900 font-sans overflow-hidden">
      <Controls 
        isPlaying={isPlaying} isLooping={isLooping}
        onPlayPause={handlePlayPause} onStop={handleStop} onRewind={handleRewind}
        onToggleLoop={() => setIsLooping(!isLooping)}
        onZoomIn={() => setCenteredZoom(zoom * 1.5)}
        onZoomOut={() => setCenteredZoom(zoom / 1.5)}
        onZoomFit={handleFitView}
        onFileLoad={handleFileSelect} onExtractPitch={handleExtractPitch}
        onSaveProject={handleSaveProject} onSaveAsProject={handleSaveAsProject} onLoadProject={handleLoadProject}
        onExportPitchCSV={handleExportPitchCSV} onExportNotesCSV={handleExportNotesCSV} onExportSVL={handleExportSVL}
        onImportPitch={handleImportPitch} onImportNotes={handleImportNotes}
        onExportSegmentsCSV={handleExportSegmentsCSV} onExportTextGrid={handleExportTextGrid}
        onExportSegmentSVL={handleExportSegmentSVL} onImportSegments={handleImportSegments}
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

        {/* Note Inspector (Floating) */}
        {selectedNoteId && selectedNote && (
            <div className="absolute top-2 right-4 z-20 bg-white shadow-md border rounded-md p-2 flex items-center gap-2 text-sm">
                <span className="font-semibold text-gray-500 text-xs uppercase">Note Pitch</span>
                <input 
                    type="number" 
                    step="0.01"
                    className="w-20 border rounded px-1 py-0.5 text-right font-mono"
                    value={pitchInputValue}
                    onChange={(e) => setPitchInputValue(e.target.value)}
                    onBlur={handlePitchInputCommit}
                    onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())}
                />
                <span className="text-gray-500">Hz</span>
                <div className="w-px h-4 bg-gray-300 mx-1"></div>
                <button 
                    onClick={() => { setSelectedNoteId(null); setSelectionRange(null); setIsLooping(false); }}
                    className="p-1 hover:bg-gray-100 text-gray-400 rounded"
                    title="Close"
                >
                    <X size={14} />
                </button>
            </div>
        )}

        <PitchVisualizer 
          pitchData={analysis.pitchData} notes={analysis.notes}
          spectrogramData={spectrogramData} showSpectrogram={showSpectrogram}
          showPitch={showPitch} showNotes={showNotes}
          currentTime={currentTime} duration={duration} zoom={zoom}
          viewStartTime={viewStartTime} selectionRange={selectionRange}
          showCandidates={showCandidates} frameDuration={audioBuffer ? YIN_HOP_SIZE / audioBuffer.sampleRate : 0}
          onViewScroll={setViewStartTime} onSeek={handleSeek} onZoomWheel={handleZoomWheel}
          onSelectionChange={handleSelectionChange} onNoteResize={handleNoteResize}
          // New Props
          selectedNoteId={selectedNoteId}
          onNoteSelect={handleNoteSelect}
          onNotePitchChange={handleNotePitchChange}
          onPitchDragEnd={handlePitchDragEnd}
        />
        
        {!fileName && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-gray-400 opacity-50">
                <div className="text-center"><p className="text-3xl font-bold">Tony Web</p><p>Load an audio file to begin</p></div>
            </div>
        )}
      </div>

      <SegmentLanes
        layers={analysis.segmentLayers}
        duration={duration} zoom={zoom} viewStartTime={viewStartTime} currentTime={currentTime}
        snapTimes={snapTimes}
        activeLayerId={activeLayerId}
        selectedSegment={selectedSegment}
        editingSegment={editingSegment}
        onLayersChange={handleSegmentLayersChange}
        onAddLayer={handleAddLayer}
        onSetActiveLayer={setActiveLayerId}
        onSelectSegment={handleSelectSegment}
        onEditSegment={setEditingSegment}
        onSeek={handleSeek}
        onPreviewSelection={handlePreviewSelection}
        onViewScroll={setViewStartTime}
        onZoomWheel={handleZoomWheel}
      />

      <div className="flex-none shadow-sm z-10 relative">
        <WaveformNavigator 
          audioBuffer={audioBuffer} currentTime={currentTime} duration={duration}
          onSeek={handleSeek} viewStartTime={viewStartTime}
          viewDuration={zoom > 0 ? viewportWidth / zoom : 0} onViewChange={setViewStartTime}
        />
      </div>

      <Mixer 
        mixerState={mixerState} 
        onUpdate={useCallback((u: Partial<MixerState>) => setMixerState(p => ({ ...p, ...u })), [])}
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
