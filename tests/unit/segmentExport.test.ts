import { describe, it, expect } from 'vitest';
import { generateSegmentsCSV, parseSegmentsCSV, generateTextGrid, parseTextGrid, generateSegmentSVL } from '../../services/segmentExport';
import { SegmentLayer } from '../../types';

const lyrics: SegmentLayer = {
  id: 'l1', name: 'Lyrics', color: '#f59e0b', colorByLabel: false,
  segments: [
    { id: 'a', start: 0.5, end: 1, label: 'Ah,' },
    { id: 'b', start: 1, end: 1.75, label: 'say "hi"' },
  ],
};
const speakers: SegmentLayer = {
  id: 'l2', name: 'Speakers', color: '#10b981', colorByLabel: true,
  segments: [
    { id: 'c', start: 0, end: 2, label: 'Anna' },
    { id: 'd', start: 2.5, end: 3, label: 'Ben' },
  ],
};

describe('segment CSV', () => {
  it('round-trips labels with commas and quotes', () => {
    const csv = generateSegmentsCSV([lyrics, speakers]);
    expect(csv.split('\n')[0]).toBe('Layer,Start(s),End(s),Duration(s),Label');
    expect(csv).toContain('Lyrics,0.5,1,0.5,"Ah,"');
    const layers = parseSegmentsCSV(csv, 'x');
    expect(layers.map(l => l.name)).toEqual(['Lyrics', 'Speakers']);
    expect(layers[0].segments.map(s => s.label)).toEqual(['Ah,', 'say "hi"']);
    expect(layers[1].segments[1]).toMatchObject({ start: 2.5, end: 3, label: 'Ben' });
  });

  it('reads plain start,end,label rows into one layer', () => {
    const layers = parseSegmentsCSV('0,1,la\n1,2,li\n', 'song');
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe('song');
    expect(layers[0].segments.map(s => s.label)).toEqual(['la', 'li']);
  });
});

describe('Praat TextGrid', () => {
  it('writes interval tiers covering the whole file', () => {
    const tg = generateTextGrid([lyrics, speakers], 4);
    expect(tg).toContain('Object class = "TextGrid"');
    expect(tg).toContain('size = 2');
    // Lyrics: gap 0-0.5, two segments, gap 1.75-4
    expect(tg).toContain('intervals: size = 4');
    expect(tg).toContain('text = "say ""hi"""');
    expect(tg).toContain('xmax = 4');
  });

  it('round-trips through the parser, dropping empty intervals', () => {
    const layers = parseTextGrid(generateTextGrid([lyrics, speakers], 4));
    expect(layers.map(l => l.name)).toEqual(['Lyrics', 'Speakers']);
    expect(layers[0].segments).toMatchObject([
      { start: 0.5, end: 1, label: 'Ah,' },
      { start: 1, end: 1.75, label: 'say "hi"' },
    ]);
  });

  it('reads the short text format and skips point tiers', () => {
    const short = `File type = "ooTextFile"
Object class = "TextGrid"

0
2.5
<exists>
2
"IntervalTier"
"words"
0
2.5
2
0
1.2
"hello"
1.2
2.5
""
"TextTier"
"events"
0
2.5
1
0.7
"click"
`;
    const layers = parseTextGrid(short);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ name: 'words' });
    expect(layers[0].segments).toMatchObject([{ start: 0, end: 1.2, label: 'hello' }]);
  });
});

describe('Sonic Visualiser SVL', () => {
  it('writes a region layer with escaped labels in sample frames', () => {
    const svl = generateSegmentSVL(lyrics, 44100);
    expect(svl).toContain('subtype="region"');
    expect(svl).toContain('<layer id="2" type="regions" name="Lyrics" model="1" />');
    expect(svl).toContain('<point frame="22050" value="1" duration="22050" label="Ah," />');
    expect(svl).toContain('label="say &quot;hi&quot;"');
  });

  it('gives each speaker its own value when colouring by label', () => {
    const svl = generateSegmentSVL(speakers, 1000);
    expect(svl).toContain('<point frame="0" value="1" duration="2000" label="Anna" />');
    expect(svl).toContain('<point frame="2500" value="2" duration="500" label="Ben" />');
    expect(svl).toContain('maximum="2"');
  });
});
