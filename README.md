
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
    *   **Zoom:** Mouse Wheel (zooms around the mouse pointer). You can't zoom out further than the whole file.
    *   **Scroll:** Drag the "Minimap" at the bottom, swipe sideways on a trackpad, or hold Shift + Scroll. The view always stays on the audio.
    *   **Fit:** Press `F` or click the Fit icon (top right) to show the whole file.
    *   **Playback:** Press `Space` to play/pause. The view turns the page when the playhead reaches the edge.

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
    *   *No overlaps:* Notes never overlap. A boundary shared by two touching notes moves both, and a boundary dragged into a neighbouring note joins it and then moves both. Hold `Alt` to move only this note's edge (it then stops at the neighbour, which lets you open a gap).
    *   *Snap:* Boundaries snap to the nearest audio frame and adjacent notes. Hold `Shift` to disable snapping.
*   **Correct Note Pitch (Innovation):**
    1.  **Double-click** a note body. Once selected, grabbing anywhere except the outer edges moves the note, even for very short notes. This selects the note and automatically highlights a "musical context" region (neighboring notes).
    2.  **Drag** the note body up or down to adjust its pitch.
    3.  **Release** the mouse to automatically hear the note played back within its context for auditory verification.
*   **Split Note:** Place the red playback cursor where you want to cut, then press `/` (Forward Slash) or click the Scissors icon.
*   **Delete Note:** Select a region containing notes and press `Backspace` or `Delete`.

### 5. Segment Layers (Lyrics, Speakers, ...)
Segment layers hold labelled time intervals that are independent of the pitch and notes, for example syllables of the lyrics or who is speaking. They appear as lanes under the pitch view and share its time axis. Segments within a layer never overlap.

*   **Add a layer:** Click `+ Segment layer` under the pitch view. Double-click a layer's name to rename it.
*   **Create a segment:** Drag in empty space in a layer, or select a time range in the pitch view and press `Enter` (the segment goes into the active, highlighted layer). New segments stop at their neighbours.
*   **Label:** Type straight away after creating a segment, or double-click a segment. `Enter` saves, `Tab` / `Shift + Tab` save and move to the next / previous segment, `Esc` cancels. Labels already used in the layer are suggested.
*   **Listen:** Clicking a segment selects its time range, so `Space` loops it.
*   **Adjust boundaries:** Drag the inner edge of a segment. A boundary shared by two touching segments moves both. Boundaries snap to notes, other segments and the playhead; hold `Shift` to disable snapping.
*   **Split / Delete:** With a segment selected, `/` splits it at the playhead and `Delete` removes it.
*   **Colour by label:** The palette icon on a layer gives each distinct label its own colour (useful for speakers).
*   **Export:** `File > Export Segments (CSV)` (all layers), `Export Segments (Praat TextGrid)` (one interval tier per layer), `Export Active Segment Layer (SVL)` (a Sonic Visualiser region layer).
*   **Import:** `File > Import Segments` reads a Praat TextGrid (interval tiers) or a CSV.

Segment layers are saved in the project file.

### 6. Shortcuts Cheat Sheet

| Action | Shortcut |
| :--- | :--- |
| **Play / Pause** | `Space` |
| **Undo** | `Cmd + Z` / `Ctrl + Z` |
| **Redo** | `Cmd + Shift + Z` / `Ctrl + Y` |
| **Create / Merge Note** | `=` |
| **Split Note / Segment** | `/` |
| **Delete Note / Segment** | `Backspace` / `Delete` |
| **Show Candidates** | `Shift + C` |
| **Pick Pitch Above** | `Cmd + Up` |
| **Pick Pitch Below** | `Cmd + Down` |
| **Save Project** | `Cmd + S` / `Ctrl + S` |
| **Nudge Cursor** | `Left` / `Right` Arrow |
| **Fit Whole File** | `F` |
| **Selection to Segment / Edit Label** | `Enter` |
| **Next / Previous Segment (while labelling)** | `Tab` / `Shift + Tab` |

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

**Tests:**
```bash
npm test               # unit tests (Vitest)
npx playwright install chromium firefox   # once
npm run test:e2e       # browser tests in Chromium and Firefox (Playwright)
```

**Deploy to GitHub Pages:** happens automatically on every push to `main` (see `.github/workflows/deploy.yml`). To deploy by hand from your machine:
```bash
npm run deploy
```