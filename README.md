
# TonyWeb V0.1

**A web-based visual interface for pitch analysis and note segmentation.**

TonyWeb is a modern browser port of the **Tony** software, designed for the scientific analysis of intonation in solo vocal recordings. It allows users to visualize pitch (f0), correct extraction errors, and segment continuous pitch curves into discrete notes.

**NEW:** Unlike the original Tony software, TonyWeb allows users to **manually correct the pitch of individual notes** by dragging them vertically, with immediate auditory feedback in the musical context.

*Note: This version does not yet provide automatic note segmentation (HMM); it is designed for high-precision manual segmentation and correction workflows.*

## Credits & Acknowledgements

This project is a web implementation inspired by the original **Tony** software developed at Queen Mary University of London.

*   **Original Software:** [Tony: Analysis of Song](https://code.soundsoftware.ac.uk/projects/tony)
*   **Original Authors:** Matthias Mauch, Chris Cannam, Rachel Bittner, George Fazekas, and Simon Dixon.
*   **Core Algorithm:** This app implements the **pYIN** algorithm (Probabilistic YIN) for pitch tracking.
    *   *Reference:* Mauch, M., & Dixon, S. (2014). pYIN: A Fundamental Frequency Estimator Using Probabilistic Threshold Distributions. *ICASSP*.
*   **Special Thanks:** To **Chris Cannam** (Centre for Digital Music, QMUL), whose work on Tony and Sonic Visualiser set the standard for audio analysis tools.

---

## User Guide

### 1. Getting Started
*   **Load Audio:** Click `File > Open Audio` (or the folder icon).
    *   *Recommendation:* Use Google Chrome or Edge for the best experience (File System Access API support).
*   **Navigation:**
    *   **Zoom:** Mouse Wheel.
    *   **Scroll:** Drag the "Minimap" at the bottom or hold Shift + Scroll.
    *   **Playback:** Press `Space` to play/pause.

### 2. Pitch Analysis (f0)
The black curve represents the fundamental frequency.
*   **Visuals:** Toggle the Spectrogram, Pitch Curve, and Notes using the "Eye" icons in the Mixer (bottom).
*   **Selection:** Click and drag on the main canvas to select a time region.

### 3. Pitch Correction
If the algorithm makes a mistake (e.g., octave error), you can correct it:
1.  **Select** the region containing the error.
2.  **Show Candidates:** Toggle the "Eye" icon in the "Pitch Correction" toolbar (or press `Shift + C`). You will see yellow dots representing alternative pitch estimates.
3.  **Choose Alternate:**
    *   `Cmd + Arrow Up` / `Ctrl + Arrow Up`: Snap the curve to the next candidate **above**.
    *   `Cmd + Arrow Down` / `Ctrl + Arrow Down`: Snap the curve to the next candidate **below**.
4.  **Recalculate (Deep Search):** If no candidates are visible, click the "Refresh" icon in the toolbar. This re-runs pYIN with a high sensitivity to find faint pitch tracks in the selected region.
5.  **Delete:** Press the Trash icon to mark the region as unvoiced (silence).

### 4. Note Segmentation
The light blue blocks represent discrete notes.

*   **Create/Merge Note:** Select a region and press `=` (Equal Sign). This creates a new note based on the median pitch of the selection. If notes already exist there, it merges/replaces them.
*   **Adjust Boundaries:** Simply hover over the left or right edge of a note (cursor changes to `<->`). Click and drag to resize.
    *   *Smart Resize:* Dragging a boundary will automatically push neighboring notes to prevent overlaps.
    *   *Snap:* Boundaries snap to the nearest audio frame and adjacent notes. Hold `Shift` to disable snapping.
*   **Correct Note Pitch (Innovation):**
    1.  **Double-click** a note body. This selects the note and automatically highlights a "musical context" region (neighboring notes).
    2.  **Drag** the note body up or down to adjust its pitch.
    3.  **Release** the mouse to automatically hear the note played back within its context for auditory verification.
*   **Split Note:** Place the red playback cursor where you want to cut, then press `/` (Forward Slash) or click the Scissors icon.
*   **Delete Note:** Select a region containing notes and press `Backspace` or `Delete`.

### 5. Shortcuts Cheat Sheet

| Action | Shortcut |
| :--- | :--- |
| **Play / Pause** | `Space` |
| **Undo** | `Cmd + Z` / `Ctrl + Z` |
| **Redo** | `Cmd + Shift + Z` / `Ctrl + Y` |
| **Create / Merge Note** | `=` |
| **Split Note** | `/` |
| **Delete Note** | `Backspace` / `Delete` |
| **Show Candidates** | `Shift + C` |
| **Pick Pitch Above** | `Cmd + Up` |
| **Pick Pitch Below** | `Cmd + Down` |
| **Save Project** | `Cmd + S` / `Ctrl + S` |
| **Nudge Cursor** | `Left` / `Right` Arrow |

---

## Browser Compatibility

**Google Chrome / Microsoft Edge (Recommended)**
*   Supports **Overwriting** files (File System Access API).
*   Supports native **Pitch Preservation** when slowing down playback speed.

**Firefox / Safari**
*   **Saving:** Due to browser security restrictions, the app cannot open a native "Save As" dialog or overwrite files. It will open a custom popup asking for a filename and then trigger a standard download.
*   **Playback Speed:** Pitch preservation (time-stretching) relies on the browser's implementation. In some versions, slowing down audio may drop the pitch (like a vinyl record).

---

## Development

This project uses React, TypeScript, and Tailwind CSS.
Analysis (pYIN/FFT) is offloaded to Web Workers for performance.

**Install Dependencies:**
```bash
npm install
```

**Run Locally:**
```bash
npm run dev
```