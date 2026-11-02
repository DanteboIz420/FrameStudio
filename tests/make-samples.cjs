const sharp = require('sharp');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const themes = [
  {
    name: 'orbit',
    bg: '#e5e7df',
    ink: '#252f29',
    accent: '#a9b7a2',
    tag: 'ORBIT®',
    title: 'Objects for',
    second: 'a slower life.',
    small: 'THOUGHTFULLY MADE. ENDLESSLY ENJOYED.',
    shape:
      '<ellipse cx="1000" cy="430" rx="190" ry="180" fill="url(#orb)"/><ellipse cx="1000" cy="445" rx="210" ry="68" fill="none" stroke="#fafcf2" stroke-width="23" transform="rotate(-35 1000 445)"/>',
  },
  {
    name: 'forma',
    bg: '#171c23',
    ink: '#ece7dc',
    accent: '#aaa6e7',
    tag: 'forma /',
    title: 'A different',
    second: 'kind of digital.',
    small: 'INDEPENDENT DESIGN &amp; DEVELOPMENT STUDIO',
    shape:
      '<g transform="translate(1005 410)"><ellipse rx="100" ry="197" fill="none" stroke="url(#orb)" stroke-width="45" transform="rotate(40)"/><ellipse rx="197" ry="100" fill="none" stroke="url(#orb)" stroke-width="45" transform="rotate(40)"/></g>',
  },
  {
    name: 'aura',
    bg: '#eaded5',
    ink: '#473530',
    accent: '#ba6b4e',
    tag: 'aura.',
    title: 'Less noise.',
    second: 'More feeling.',
    small: 'AN EXPLORATION IN EVERYDAY WELLBEING',
    shape:
      '<path d="M880 550 L880 355 Q880 225 1010 225 Q1140 225 1140 355 L1140 550 Z" fill="url(#orb)"/><circle cx="1010" cy="395" r="80" fill="#eaded5"/>',
  },
];
(async () => {
  for (const t of themes) {
    const svg = `<svg width="1440" height="900" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="orb" cx="30%" cy="20%" r="80%"><stop stop-color="#ffffff"/><stop offset=".3" stop-color="${t.accent}"/><stop offset="1" stop-color="${t.ink}"/></radialGradient></defs><rect width="1440" height="900" fill="${t.bg}"/><text x="76" y="85" font-family="Arial" font-size="30" font-weight="700" fill="${t.ink}">${t.tag}</text><g fill="${t.ink}" font-family="Arial" font-size="14"><text x="1000" y="80">Work</text><text x="1100" y="80">About</text><text x="1220" y="80">Get in touch ↗</text></g><line x1="76" x2="1360" y1="122" y2="122" stroke="${t.ink}" opacity=".2"/><text x="80" y="268" font-family="Arial" font-size="11" letter-spacing="3" fill="${t.ink}">${t.small}</text><text x="76" y="380" font-family="Georgia" font-size="88" letter-spacing="-4" fill="${t.ink}">${t.title}</text><text x="76" y="480" font-family="Georgia" font-style="italic" font-size="88" letter-spacing="-4" fill="${t.ink}">${t.second}</text><rect x="80" y="540" width="188" height="47" rx="25" fill="${t.ink}"/><text x="112" y="570" font-family="Arial" font-size="13" fill="${t.bg}">Explore the collection ↗</text>${t.shape}<line x1="76" x2="1360" y1="750" y2="750" stroke="${t.ink}" opacity=".2"/><g fill="${t.ink}" font-family="Arial" font-size="11"><text x="80" y="796">GOOD THINGS TAKE THEIR OWN TIME.</text><text x="1150" y="796">SCROLL TO DISCOVER ↓</text></g><text x="80" y="854" font-family="Arial" font-size="10" fill="${t.ink}" opacity=".5">CONCEPT WEBSITE · FRAME STUDIO SAMPLE</text></svg>`;
    const png = path.join(root, 'assets', t.name + '.png');
    await sharp(Buffer.from(svg)).png().toFile(png);
    const exe = require('./engine.cjs').engine('ffmpeg');
    const r = spawnSync(
      exe,
      [
        '-v',
        'error',
        '-i',
        png,
        '-vf',
        "zoompan=z='1+0.00018*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=120:s=1280x800:fps=30",
        '-t',
        '4',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-an',
        '-y',
        path.join(root, 'assets', t.name + '.mp4'),
      ],
      { windowsHide: true },
    );
    if (r.status !== 0) throw Error(String(r.stderr));
    console.log(t.name + ' sample created');
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
