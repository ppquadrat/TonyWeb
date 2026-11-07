import { Segment, SegmentLayer } from '../types';
import { createLayer } from '../utils/segmentUtils';

/**
 * SEGMENT LAYER FORMATS
 * CSV:      Layer, Start(s), End(s), Duration(s), Label  (one row per segment, all layers)
 * TextGrid: Praat long text format, one IntervalTier per layer. Gaps become empty intervals.
 * SVL:      Sonic Visualiser region layer, one layer per file.
 */

const fmt = (t: number) => Number(t.toFixed(6)).toString();

// --- CSV ---

const csvField = (value: string) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const generateSegmentsCSV = (layers: SegmentLayer[]) => {
    let csv = 'Layer,Start(s),End(s),Duration(s),Label\n';
    layers.forEach(layer => {
        layer.segments.forEach(s => {
            csv += [csvField(layer.name), fmt(s.start), fmt(s.end), fmt(s.end - s.start), csvField(s.label)].join(',') + '\n';
        });
    });
    return csv;
};

// RFC 4180 rows (quoted fields may contain commas, quotes and newlines)
export const parseCSVRows = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') inQuotes = false;
            else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some(f => f !== '')) rows.push(row);
            row = [];
        } else {
            field += c;
        }
    }
    row.push(field);
    if (row.some(f => f !== '')) rows.push(row);
    return rows;
};

/**
 * Import segments from CSV. Accepts this app's export (Layer,Start,End,Duration,Label)
 * or plain Start,End,Label rows, which go into one layer named after the file.
 */
export const parseSegmentsCSV = (text: string, defaultLayerName: string): SegmentLayer[] => {
    const rows = parseCSVRows(text);
    if (rows.length === 0) return [];
    const header = rows[0].map(h => h.trim().toLowerCase());
    // A header row has no numbers in its first two fields
    const hasHeader = isNaN(parseFloat(header[0])) && isNaN(parseFloat(header[1] ?? ''));
    const col = (name: string) => header.findIndex(h => h.startsWith(name));
    const layerCol = hasHeader ? col('layer') : -1;
    const startCol = hasHeader && col('start') >= 0 ? col('start') : (layerCol >= 0 ? 1 : 0);
    const endCol = hasHeader && col('end') >= 0 ? col('end') : startCol + 1;
    const labelCol = hasHeader && col('label') >= 0 ? col('label') : endCol + 1;

    const layers: SegmentLayer[] = [];
    const byName = new Map<string, SegmentLayer>();
    for (const r of rows.slice(hasHeader ? 1 : 0)) {
        const start = parseFloat(r[startCol]);
        const end = parseFloat(r[endCol]);
        if (isNaN(start) || isNaN(end) || end <= start) continue;
        const name = layerCol >= 0 && r[layerCol] ? r[layerCol] : defaultLayerName;
        let layer = byName.get(name);
        if (!layer) {
            layer = createLayer(layers, name);
            byName.set(name, layer);
            layers.push(layer);
        }
        layer.segments.push({ id: crypto.randomUUID(), start, end, label: r[labelCol] ?? '' });
    }
    return layers.map(l => ({ ...l, segments: removeOverlaps(l.segments) }));
};

// Keep segments sorted and drop any that overlap an earlier one
const removeOverlaps = (segments: Segment[]) => {
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const result: Segment[] = [];
    for (const s of sorted) {
        const last = result[result.length - 1];
        if (last && s.start < last.end - 1e-9) continue;
        result.push(s);
    }
    return result;
};

// --- Praat TextGrid ---

const tgString = (s: string) => `"${s.replace(/"/g, '""')}"`;

// Fill gaps with empty intervals so the tier covers [0, duration] (Praat requires this)
const toIntervals = (segments: Segment[], duration: number) => {
    const intervals: { xmin: number, xmax: number, text: string }[] = [];
    let t = 0;
    for (const s of [...segments].sort((a, b) => a.start - b.start)) {
        if (s.start > t + 1e-9) intervals.push({ xmin: t, xmax: s.start, text: '' });
        intervals.push({ xmin: s.start, xmax: s.end, text: s.label });
        t = s.end;
    }
    if (duration > t + 1e-9 || intervals.length === 0) intervals.push({ xmin: t, xmax: Math.max(duration, t), text: '' });
    return intervals;
};

export const generateTextGrid = (layers: SegmentLayer[], duration: number) => {
    const lines = [
        'File type = "ooTextFile"',
        'Object class = "TextGrid"',
        '',
        'xmin = 0 ',
        `xmax = ${fmt(duration)} `,
        'tiers? <exists> ',
        `size = ${layers.length} `,
        'item []: ',
    ];
    layers.forEach((layer, i) => {
        const intervals = toIntervals(layer.segments, duration);
        lines.push(
            `    item [${i + 1}]:`,
            '        class = "IntervalTier" ',
            `        name = ${tgString(layer.name)} `,
            '        xmin = 0 ',
            `        xmax = ${fmt(duration)} `,
            `        intervals: size = ${intervals.length} `,
        );
        intervals.forEach((iv, j) => {
            lines.push(
                `        intervals [${j + 1}]:`,
                `            xmin = ${fmt(iv.xmin)} `,
                `            xmax = ${fmt(iv.xmax)} `,
                `            text = ${tgString(iv.text)} `,
            );
        });
    });
    return lines.join('\n') + '\n';
};

/**
 * Parse a Praat TextGrid (long or short text format). Interval tiers become layers;
 * empty intervals are dropped. Point tiers (TextTier) are skipped.
 */
export const parseTextGrid = (text: string): SegmentLayer[] => {
    // Tokens: quoted strings, numbers and <exists>; [n] indices and keys are skipped
    const tokenRe = /"((?:[^"]|"")*)"|\[\d*\]|<exists>|<absent>|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;
    const tokens: (string | number)[] = [];
    for (const m of text.replace(/^﻿/, '').matchAll(tokenRe)) {
        if (m[1] !== undefined) tokens.push(m[1].replace(/""/g, '"'));
        else if (m[0].startsWith('[') || m[0] === '<exists>' || m[0] === '<absent>') continue;
        else tokens.push(parseFloat(m[0]));
    }
    let p = 0;
    const next = () => tokens[p++];
    const num = () => { const v = next(); if (typeof v !== 'number') throw new Error('Invalid TextGrid'); return v; };
    const str = () => { const v = next(); if (typeof v !== 'string') throw new Error('Invalid TextGrid'); return v; };

    if (str() !== 'ooTextFile' || str() !== 'TextGrid') throw new Error('Not a TextGrid file');
    num(); num(); // xmin, xmax
    const size = num();
    const layers: SegmentLayer[] = [];
    for (let i = 0; i < size; i++) {
        const tierClass = str();
        const name = str();
        num(); num(); // tier xmin, xmax
        const n = num();
        const layer = createLayer(layers, name);
        for (let j = 0; j < n; j++) {
            if (tierClass === 'IntervalTier') {
                const xmin = num(); const xmax = num(); const label = str();
                if (label.trim() !== '') layer.segments.push({ id: crypto.randomUUID(), start: xmin, end: xmax, label });
            } else {
                num(); str(); // point tier: time, mark
            }
        }
        if (tierClass === 'IntervalTier') layers.push(layer);
    }
    return layers;
};

// --- Sonic Visualiser region layer ---

const xmlEscape = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const generateSegmentSVL = (layer: SegmentLayer, sampleRate: number) => {
    // Region value: one row per distinct label when colouring by label (e.g. speakers), otherwise 1
    const labels = [...new Set(layer.segments.map(s => s.label))];
    const valueOf = (s: Segment) => layer.colorByLabel ? labels.indexOf(s.label) + 1 : 1;
    const maxValue = layer.colorByLabel ? Math.max(1, labels.length) : 1;
    const end = layer.segments.length ? Math.round(layer.segments[layer.segments.length - 1].end * sampleRate) : 0;
    const points = layer.segments.map(s => {
        const frame = Math.round(s.start * sampleRate);
        const dur = Math.round((s.end - s.start) * sampleRate);
        return `      <point frame="${frame}" value="${valueOf(s)}" duration="${dur}" label="${xmlEscape(s.label)}" />`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE sonic-visualiser>
<sv>
  <data>
    <model id="1" name="${xmlEscape(layer.name)}" sampleRate="${sampleRate}" start="0" end="${end}" type="sparse" dimensions="3" resolution="1" notifyOnAdd="true" dataset="0" subtype="region" valueQuantization="0" minimum="0" maximum="${maxValue}" units="" />
    <dataset id="0" dimensions="3">
${points.join('\n')}
    </dataset>
  </data>
  <display>
    <layer id="2" type="regions" name="${xmlEscape(layer.name)}" model="1" />
  </display>
</sv>
`;
};
