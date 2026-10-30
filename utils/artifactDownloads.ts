// Saving files when TonyWeb runs inside a claude.ai artifact preview, where the page is
// sandboxed: normal downloads and the File System Access API are blocked there, but the
// viewer offers a "downloads" capability. On a normal website this is never used.

interface ArtifactDownloads {
  save(request: { filename: string, data: string | Blob }): Promise<{ status: string }>;
}

// File types the artifact viewer lets a page save
const ALLOWED_EXTENSIONS = ['txt', 'json', 'csv', 'md'];

let downloadsPromise: Promise<ArtifactDownloads | null> | null = null;

export const getArtifactDownloads = (): Promise<ArtifactDownloads | null> => {
  const claude = (window as any).claude;
  if (!claude?.use) return Promise.resolve(null);
  downloadsPromise ??= Promise.resolve(claude.use('downloads')).catch(() => null);
  return downloadsPromise;
};

// .tonyweb projects are JSON; other unsupported types (.TextGrid, .svl) get .txt appended
export const artifactFilename = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ALLOWED_EXTENSIONS.includes(ext)) return name;
  if (ext === 'tonyweb') return name.replace(/\.tonyweb$/i, '.json');
  return `${name}.txt`;
};
