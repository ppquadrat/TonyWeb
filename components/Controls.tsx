
import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Square, ZoomIn, ZoomOut, Upload, Activity, SkipBack, Repeat, Save, Eye, EyeOff, ChevronUp, ChevronDown, RefreshCw, Trash2, Undo2, Redo2, Plus, Scissors, FileText, Download, FolderOpen } from 'lucide-react';

interface ControlsProps {
  isPlaying: boolean;
  isLooping: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onRewind: () => void;
  onToggleLoop: () => void;
  
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFileLoad: (file: File) => void;
  onExtractPitch: () => void;
  
  // File Operations
  onSaveProject: () => void;
  onSaveAsProject: () => void;
  onLoadProject: (file: File) => void;
  onExportPitchCSV: () => void;
  onExportNotesCSV: () => void;
  onExportSVL: () => void;
  onImportPitch: (file: File) => void;
  onImportNotes: (file: File) => void;

  isAnalyzing: boolean;
  isRecalculating?: boolean;
  hasData: boolean;
  fileName: string | null;

  // Correction Mode
  selectionActive: boolean;
  showCandidates: boolean;
  onToggleCandidates: () => void;
  onShiftUp: () => void;
  onShiftDown: () => void;
  onRecalculateCandidates: () => void;
  onDeletePitch: () => void;

  // Note Tools
  onCreateNote: () => void;
  onDeleteNote: () => void;
  onSplitNote: () => void;

  // Undo/Redo
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const Controls: React.FC<ControlsProps> = ({
  isPlaying,
  isLooping,
  onPlayPause,
  onStop,
  onRewind,
  onToggleLoop,
  onZoomIn,
  onZoomOut,
  onFileLoad,
  onExtractPitch,
  onSaveProject,
  onSaveAsProject,
  onLoadProject,
  onExportPitchCSV,
  onExportNotesCSV,
  onExportSVL,
  onImportPitch,
  onImportNotes,
  isAnalyzing,
  isRecalculating = false,
  hasData,
  fileName,
  selectionActive,
  showCandidates,
  onToggleCandidates,
  onShiftUp,
  onShiftDown,
  onRecalculateCandidates,
  onDeletePitch,
  onCreateNote,
  onDeleteNote,
  onSplitNote,
  canUndo,
  canRedo,
  onUndo,
  onRedo
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const importPitchRef = useRef<HTMLInputElement>(null);
  const importNotesRef = useRef<HTMLInputElement>(null);
  
  const [showFileMenu, setShowFileMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowFileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAction = (action: () => void, e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    action();
  };

  const handleLoadClick = async () => {
    setShowFileMenu(false);
    if ('showOpenFilePicker' in window) {
      try {
        const pickerOpts = {
          id: 'tony-web-audio-load', 
          startIn: 'downloads',
          types: [
            {
              description: 'Audio Files',
              accept: {
                'audio/*': ['.wav', '.mp3', '.ogg', '.flac', '.m4a']
              }
            },
          ],
          excludeAcceptAllOption: true,
          multiple: false
        };
        // @ts-ignore
        const [fileHandle] = await window.showOpenFilePicker(pickerOpts);
        const file = await fileHandle.getFile();
        onFileLoad(file);
      } catch (err) {
        console.debug('File picker cancelled or failed', err);
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        onFileLoad(e.target.files[0]);
    }
  };

  return (
    <div className="h-16 bg-gray-100 border-b border-gray-300 flex items-center px-4 justify-between select-none text-gray-800 z-50">
      
      {/* Left Group: Transport & Edit */}
      <div className="flex items-center gap-4">
        
        {/* FILE MENU */}
        <div className="relative" ref={menuRef}>
            <button 
                onClick={() => setShowFileMenu(!showFileMenu)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-colors border focus:outline-none ${showFileMenu ? 'bg-gray-200 border-gray-400' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
            >
                <FolderOpen size={18} />
                <span>File</span>
            </button>

            {showFileMenu && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-xl py-1 z-50 text-sm">
                    <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Project</div>
                    <button onClick={handleLoadClick} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2">
                        <Upload size={14} /> Open Audio...
                    </button>
                    <button onClick={() => { onSaveProject(); setShowFileMenu(false); }} disabled={!hasData} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50">
                        <Save size={14} /> Save Project (.json)
                    </button>
                    <button onClick={() => { onSaveAsProject(); setShowFileMenu(false); }} disabled={!hasData} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50">
                        <Save size={14} /> Save Project As...
                    </button>
                    <button onClick={() => { projectInputRef.current?.click(); setShowFileMenu(false); }} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2">
                        <FolderOpen size={14} /> Load Project...
                    </button>

                    <div className="border-t border-gray-100 my-1"></div>
                    <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Export</div>
                    
                    <button onClick={() => { onExportPitchCSV(); setShowFileMenu(false); }} disabled={!hasData} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50">
                        <FileText size={14} /> Export Pitch (CSV)
                    </button>
                    <button onClick={() => { onExportNotesCSV(); setShowFileMenu(false); }} disabled={!hasData} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50">
                        <FileText size={14} /> Export Notes (CSV)
                    </button>
                    <button onClick={() => { onExportSVL(); setShowFileMenu(false); }} disabled={!hasData} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50">
                        <Activity size={14} /> Export SVL (Sonic Visualiser)
                    </button>

                    <div className="border-t border-gray-100 my-1"></div>
                    <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Import</div>
                    
                    <button onClick={() => { importPitchRef.current?.click(); setShowFileMenu(false); }} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2">
                        <Download size={14} /> Import Pitch (CSV)
                    </button>
                    <button onClick={() => { importNotesRef.current?.click(); setShowFileMenu(false); }} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2">
                        <Download size={14} /> Import Notes (CSV)
                    </button>
                </div>
            )}
            
            {/* Hidden Inputs for File Operations */}
            <input 
                ref={fileInputRef}
                type="file" 
                accept="audio/*" 
                onChange={handleInputChange} 
                className="hidden" 
            />
            <input 
                ref={projectInputRef}
                type="file" 
                accept=".json,.tonyweb" 
                onChange={(e) => { if(e.target.files?.[0]) onLoadProject(e.target.files[0]); e.target.value = ''; }} 
                className="hidden" 
            />
             <input 
                ref={importPitchRef}
                type="file" 
                accept=".csv" 
                onChange={(e) => { if(e.target.files?.[0]) onImportPitch(e.target.files[0]); e.target.value = ''; }} 
                className="hidden" 
            />
             <input 
                ref={importNotesRef}
                type="file" 
                accept=".csv" 
                onChange={(e) => { if(e.target.files?.[0]) onImportNotes(e.target.files[0]); e.target.value = ''; }} 
                className="hidden" 
            />
        </div>

        {/* Transport */}
        <div className="flex items-center gap-1 bg-gray-200 rounded-lg p-1 border border-gray-300 relative">
          <button 
            onClick={(e) => handleAction(onRewind, e)}
            className="p-2 hover:bg-gray-300 rounded text-gray-700 transition-colors focus:outline-none"
            title="Rewind to Start"
          >
            <SkipBack size={20} />
          </button>
          
          <button 
            onClick={(e) => handleAction(onPlayPause, e)}
            className="p-2 hover:bg-gray-300 rounded text-gray-700 transition-colors focus:outline-none"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button 
            onClick={(e) => handleAction(onStop, e)}
            className="p-2 hover:bg-gray-300 rounded text-gray-700 transition-colors focus:outline-none"
            title="Stop"
          >
            <Square size={20} />
          </button>
          <div className="w-px h-6 bg-gray-300 mx-1"></div>
          <button 
            onClick={(e) => handleAction(onToggleLoop, e)}
            className={`p-2 rounded transition-colors focus:outline-none ${isLooping ? 'bg-blue-200 text-blue-800 hover:bg-blue-300' : 'hover:bg-gray-300 text-gray-700'}`}
            title="Loop Selection"
          >
            <Repeat size={20} />
          </button>
        </div>

        {/* Global Undo/Redo */}
        <div className="flex items-center gap-1 bg-gray-200 rounded-lg p-1 border border-gray-300">
             <button 
                onClick={(e) => handleAction(onUndo, e)}
                disabled={!canUndo}
                className={`p-2 rounded transition-colors focus:outline-none ${!canUndo ? 'text-gray-400 cursor-not-allowed' : 'hover:bg-gray-300 text-gray-700'}`}
                title="Undo (Ctrl+Z)"
             >
                <Undo2 size={18} />
             </button>
             <button 
                onClick={(e) => handleAction(onRedo, e)}
                disabled={!canRedo}
                className={`p-2 rounded transition-colors focus:outline-none ${!canRedo ? 'text-gray-400 cursor-not-allowed' : 'hover:bg-gray-300 text-gray-700'}`}
                title="Redo (Ctrl+Shift+Z)"
             >
                <Redo2 size={18} />
             </button>
        </div>

        {/* Note Tools */}
        <div className={`flex flex-col items-center justify-center gap-0 bg-gray-200 rounded-lg px-2 py-0.5 border border-gray-300`}>
            <div className="flex items-center gap-1">
                <button 
                    onClick={(e) => handleAction(onCreateNote, e)}
                    disabled={!selectionActive}
                    className="p-1.5 hover:bg-blue-100 hover:text-blue-700 rounded text-gray-700 transition-colors focus:outline-none disabled:text-gray-400"
                    title="Create Note (=)"
                >
                    <Plus size={18} />
                </button>
                <button 
                    onClick={(e) => handleAction(onSplitNote, e)}
                    disabled={!hasData}
                    className="p-1.5 hover:bg-blue-100 hover:text-blue-700 rounded text-gray-700 transition-colors focus:outline-none disabled:text-gray-400"
                    title="Split Note at Cursor (/)"
                >
                    <Scissors size={18} />
                </button>
                <button 
                    onClick={(e) => handleAction(onDeleteNote, e)}
                    disabled={!selectionActive}
                    className="p-1.5 hover:bg-red-100 hover:text-red-700 rounded text-gray-700 transition-colors focus:outline-none disabled:text-gray-400"
                    title="Delete Note (Backspace/Delete)"
                >
                    <Trash2 size={18} />
                </button>
            </div>
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none pb-0.5">Notes</span>
        </div>

        {/* Correction Tools (f0) */}
        <div className={`flex flex-col items-center justify-center gap-0 bg-gray-200 rounded-lg px-2 py-0.5 border border-gray-300 transition-opacity ${selectionActive ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
             <div className="flex items-center gap-1">
                <button 
                    onClick={(e) => handleAction(onToggleCandidates, e)}
                    className={`p-1.5 rounded transition-colors focus:outline-none ${showCandidates ? 'bg-yellow-200 text-yellow-800' : 'hover:bg-gray-300 text-gray-700'}`}
                    title="Show Candidates (Shift+C)"
                >
                    {showCandidates ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
                <div className="w-px h-5 bg-gray-300 mx-0.5"></div>
                <button 
                    onClick={(e) => handleAction(onShiftUp, e)}
                    disabled={!selectionActive}
                    className="p-1.5 hover:bg-gray-300 rounded text-gray-700 transition-colors focus:outline-none disabled:text-gray-400"
                    title="Pick Next Candidate Above (Cmd+Up)"
                >
                    <ChevronUp size={18} />
                </button>
                <button 
                    onClick={(e) => handleAction(onShiftDown, e)}
                    disabled={!selectionActive}
                    className="p-1.5 hover:bg-gray-300 rounded text-gray-700 transition-colors focus:outline-none disabled:text-gray-400"
                    title="Pick Next Candidate Below (Cmd+Down)"
                >
                    <ChevronDown size={18} />
                </button>
                <div className="w-px h-5 bg-gray-300 mx-0.5"></div>
                <button 
                    onClick={(e) => handleAction(onRecalculateCandidates, e)}
                    disabled={!selectionActive || isRecalculating}
                    className={`p-1.5 hover:bg-gray-300 rounded text-gray-700 transition-colors focus:outline-none disabled:text-gray-400`}
                    title="Recalculate Candidates (Deep Search)"
                >
                    <RefreshCw size={18} className={isRecalculating ? "animate-spin" : ""} />
                </button>
                <button 
                    onClick={(e) => handleAction(onDeletePitch, e)}
                    disabled={!selectionActive}
                    className="p-1.5 hover:bg-red-100 hover:text-red-700 rounded text-gray-700 transition-colors focus:outline-none disabled:text-gray-400"
                    title="Delete Pitch in Selection"
                >
                    <Trash2 size={18} />
                </button>
            </div>
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none pb-0.5">Pitch Correction</span>
        </div>

        <div className="h-8 w-px bg-gray-300 mx-2"></div>
        
        <div className="text-xs text-gray-500 font-mono truncate max-w-[120px]" title={fileName || ""}>
            {fileName || "No Audio"}
        </div>

        <button 
            onClick={(e) => handleAction(onExtractPitch, e)}
            disabled={isAnalyzing || !fileName}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-sm border focus:outline-none ${
                isAnalyzing || !fileName 
                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' 
                : 'bg-white hover:bg-gray-50 text-gray-800 border-gray-300'
            }`}
        >
            <Activity size={16} className={isAnalyzing || !fileName ? "text-gray-400" : "text-blue-600"} />
            {isAnalyzing ? "Analyzing..." : "Extract Pitch"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button 
            onClick={(e) => handleAction(onZoomOut, e)}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-600 focus:outline-none"
            title="Zoom Out"
        >
            <ZoomOut size={20} />
        </button>
        <button 
            onClick={(e) => handleAction(onZoomIn, e)}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-600 focus:outline-none"
            title="Zoom In"
        >
            <ZoomIn size={20} />
        </button>
      </div>
    </div>
  );
};

export default Controls;
