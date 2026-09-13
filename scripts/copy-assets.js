const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist', 'onboarding');

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(root, 'src', 'onboarding', 'index.html'), path.join(outDir, 'index.html'));
console.log('copied onboarding/index.html to dist');
