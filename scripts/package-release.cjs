const fs = require('node:fs/promises'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process'),
  { createHash } = require('node:crypto'),
  { createReadStream } = require('node:fs');
const root = path.resolve(__dirname, '..'),
  version = require('../package.json').version;
(async () => {
  const dir = path.join(root, 'dist/win-unpacked');
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
    await fs.copyFile(path.join(root, file), path.join(dir, file));
  await fs.writeFile(
    path.join(dir, 'START HERE.txt'),
    `Frame Studio ${version} - Windows x64 early beta\r\n\r\nOpen Frame Studio.exe. Keep the full extracted folder together.\r\nNo Node.js installation is needed.\r\n\r\nFFmpeg and FFprobe are included. No engine download or installation is needed.\r\nEditing and exporting work offline on your computer.\r\n\r\nTry Explore a sample project, or drop in your own recording.\r\nSave editable projects with Ctrl+S. Export opens range and quality settings.\r\n\r\nDocumentation, source, issues and license:\r\nhttps://github.com/DanteboIz420/FrameStudio\r\n\r\nApplication code: MIT. Third-party licenses remain separate; see\r\nTHIRD_PARTY_NOTICES.md, LICENSE.electron.txt and LICENSES.chromium.html.\r\n`,
  );
  // Windows Explorer hides archives containing bsdtar's leading './' directory.
  // Use Windows' ZIP implementation and omit the base directory entirely.
  const archive = path.join(root, 'dist', `Frame-Studio-${version}-Windows-x64.zip`);
  const temporary = path.join(root, 'dist', `Frame-Studio-${version}-${Date.now()}.zip`);
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:FRAME_PACKAGE_SOURCE, $env:FRAME_PACKAGE_DESTINATION, [System.IO.Compression.CompressionLevel]::Optimal, $false)",
    ],
    {
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, FRAME_PACKAGE_SOURCE: dir, FRAME_PACKAGE_DESTINATION: temporary },
    },
  );
  if (result.status !== 0) throw Error(result.stderr || 'ZIP creation failed.');
  await fs.rename(temporary, archive);
  const compatibility = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop'; $shell=New-Object -ComObject Shell.Application; $folder=$shell.NameSpace($env:FRAME_PACKAGE_DESTINATION); if($null -eq $folder -or $folder.Items().Count -eq 0){throw 'Windows Explorer cannot list the release ZIP'}; Write-Output ('Windows Explorer entries: '+$folder.Items().Count)",
    ],
    {
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, FRAME_PACKAGE_DESTINATION: archive },
    },
  );
  if (compatibility.status !== 0)
    throw Error(compatibility.stderr || 'Windows ZIP compatibility check failed.');
  console.log(compatibility.stdout.trim());
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  await fs.writeFile(
    path.join(root, 'dist/SHA256SUMS.txt'),
    hash.digest('hex') + '  ' + path.basename(archive) + '\n',
  );
  console.log(archive);
  console.log('Windows archive and checksum ready.');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
