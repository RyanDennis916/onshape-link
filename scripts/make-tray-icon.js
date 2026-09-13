const fs = require('node:fs');
const path = require('node:path');
const { Surface, stroke, cubeSegments } = require('./png');

function render(size) {
  const cx = size / 2 - 0.5;
  const cy = size / 2 - 0.5;
  return new Surface(size, size)
    .paint(stroke(cubeSegments(cx, cy, size * 0.42), size * 0.055), [0, 0, 0])
    .toPng();
}

const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'trayTemplate.png'), render(16));
fs.writeFileSync(path.join(buildDir, 'trayTemplate@2x.png'), render(32));
console.log('wrote tray icons');
