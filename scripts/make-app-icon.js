const fs = require('node:fs');
const path = require('node:path');
const { Surface, roundedRect, stroke, cubeSegments } = require('./png');

const SIZE = 1024;
const BLUE = [46, 90, 214];
const WHITE = [255, 255, 255];

function render() {
  const surface = new Surface(SIZE, SIZE).paint(roundedRect(0, 0, SIZE, SIZE, SIZE * 0.22), BLUE);
  return surface
    .paint(stroke(cubeSegments(SIZE / 2, SIZE / 2, SIZE * 0.3), SIZE * 0.045), WHITE)
    .toPng();
}

const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.png'), render());
console.log('wrote build/icon.png');
