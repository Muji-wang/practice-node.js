const fs = require('fs/promises');
const path = require('path');

const FORMAT_JSON = process.argv.includes('--json');

const CATEGORIES = [
  { 
    id: '1',
    code: 'video_music',
    name: '影片與音樂',
    description: '影音串流與音樂服務等內容型網站。',
    sampleHosts: ['youtube.com', 'spotify.com', 'twitch.tv', 'vimeo.com', 'music.apple.com'],
  },
  { 
    id:'2',
    code: 'social',
    name: '社群',
    description: '社群平台與討論區等互動網站。',
    sampleHosts: ['facebook.com', 'instagram.com', 'x.com', 'reddit.com', 'tiktok.com'],
  },
  { 
    id:'3',
    code: 'gaming',
    name: '遊戲',
    description: '線上遊戲、平台等遊戲網站。',
    sampleHosts: ['roblox.com', 'minecraft.net', 'epicgames.com', 'leagueoflegends.com', 'store.steampowered.com'],
  },
  { 
    id:'4',
    code: 'learning',
    name: '學習',
    description: '線上學習、百科或學校系統等學習資源。',
    sampleHosts: ['khanacademy.org', 'coursera.org', 'edx.org', 'classroom.google.com', 'wikipedia.org'],
  },
];

function toCSV(rows) {
  const cols = ['code', 'name', 'description', 'sampleHosts'];
  const header = cols.join(',');
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map(r => {
    const row = {
      code: r.code,
      name: r.name,
      description: r.description ?? '',
      sampleHosts: (r.sampleHosts ?? []).join('|'),
    };
    return [row.code, row.name, row.description, row.sampleHosts]
      .map(esc).join(',');
  }).join('\n');

  return `${header}\n${body}\n`;
}

(async () => {
  const outDir = path.resolve('out/baseline');
  await fs.mkdir(outDir, { recursive: true });

  if (FORMAT_JSON) {
    const outPath = path.join(outDir, 'category_baseline.json');
    await fs.writeFile(outPath, JSON.stringify(CATEGORIES, null, 2), 'utf8');
    console.log(`輸出：${outPath}`);
  } else {
    const outPath = path.join(outDir, 'category_baseline.csv');
    const csv = toCSV(CATEGORIES);
    await fs.writeFile(outPath, csv, 'utf8');
    console.log(`輸出：${outPath}`);
  }
})();