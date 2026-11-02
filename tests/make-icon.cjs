const sharp = require('sharp'),
  fs = require('node:fs/promises'),
  path = require('node:path');
(async () => {
  const png = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="54" fill="#242527"/><rect x="16" y="16" width="224" height="224" rx="43" fill="none" stroke="#4a4036" stroke-width="2"/><text x="69" y="191" font-family="Georgia" font-style="italic" font-size="216" fill="#e7ac86">f</text><circle cx="189" cy="181" r="13" fill="#e7ac86"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const dir = path.join(__dirname, '../assets');
  await fs.writeFile(path.join(dir, 'icon.png'), png);
  const h = Buffer.alloc(22);
  h.writeUInt16LE(1, 2);
  h.writeUInt16LE(1, 4);
  h.writeUInt16LE(1, 10);
  h.writeUInt16LE(32, 12);
  h.writeUInt32LE(png.length, 14);
  h.writeUInt32LE(22, 18);
  await fs.writeFile(path.join(dir, 'icon.ico'), Buffer.concat([h, png]));
})();
