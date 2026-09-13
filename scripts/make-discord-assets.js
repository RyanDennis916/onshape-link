const fs = require('node:fs');
const path = require('node:path');
const {
  Surface,
  circle,
  stroke,
  difference,
  union,
  cubeSegments
} = require('./png');

const SIZE = 512;
const WHITE = [255, 255, 255];

function base(color) {
  return new Surface(SIZE, SIZE).paint(() => true, color);
}

function cube(surface, cx, cy, r, weight) {
  return surface.paint(stroke(cubeSegments(cx, cy, r), weight), WHITE);
}

function onshape() {
  return cube(base([20, 128, 140]), SIZE / 2, SIZE / 2, SIZE * 0.3, SIZE * 0.038).toPng();
}

function active() {
  return cube(base([59, 165, 93]), SIZE / 2, SIZE / 2, SIZE * 0.3, SIZE * 0.045).toPng();
}

function idle() {
  const moon = difference(
    circle(SIZE * 0.52, SIZE * 0.5, SIZE * 0.26),
    circle(SIZE * 0.62, SIZE * 0.4, SIZE * 0.24)
  );
  return base([110, 118, 129]).paint(moon, WHITE).toPng();
}

function partStudio() {
  return cube(base([88, 101, 242]), SIZE / 2, SIZE / 2, SIZE * 0.3, SIZE * 0.045).toPng();
}

function assembly() {
  const surface = base([137, 87, 229]);
  const r = SIZE * 0.17;
  const w = SIZE * 0.032;
  cube(surface, SIZE * 0.37, SIZE * 0.37, r, w);
  cube(surface, SIZE * 0.63, SIZE * 0.37, r, w);
  cube(surface, SIZE * 0.5, SIZE * 0.64, r, w);
  return surface.toPng();
}

function drawing() {
  const x = SIZE * 0.24;
  const y = SIZE * 0.2;
  const w = SIZE * 0.52;
  const h = SIZE * 0.6;
  const rect = (rx, ry, rw, rh) => [
    [rx, ry, rx + rw, ry],
    [rx + rw, ry, rx + rw, ry + rh],
    [rx + rw, ry + rh, rx, ry + rh],
    [rx, ry + rh, rx, ry]
  ];
  const sheet = rect(x, y, w, h);
  const title = rect(x + w * 0.48, y + h * 0.74, w * 0.36, h * 0.13);
  const part = circle(x + w * 0.5, y + h * 0.38, w * 0.2);
  const hole = circle(x + w * 0.5, y + h * 0.38, w * 0.075);
  return base([210, 153, 34])
    .paint(stroke(sheet, SIZE * 0.026), WHITE)
    .paint(difference(part, circle(x + w * 0.5, y + h * 0.38, w * 0.2 - SIZE * 0.04)), WHITE)
    .paint(difference(hole, circle(x + w * 0.5, y + h * 0.38, w * 0.075 - SIZE * 0.028)), WHITE)
    .paint(stroke(title, SIZE * 0.02), WHITE)
    .toPng();
}

const outDir = path.join(__dirname, '..', 'build', 'discord-assets');
fs.mkdirSync(outDir, { recursive: true });

const assets = {
  onshape,
  active,
  idle,
  'part-studio': partStudio,
  assembly,
  drawing
};

for (const [name, render] of Object.entries(assets)) {
  fs.writeFileSync(path.join(outDir, `${name}.png`), render());
  console.log(`wrote ${name}.png`);
}
