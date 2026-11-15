'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const REPO = '/Volumes/SanDisk1Tb/TOWNMOUSE/repo';
const ROOT = path.join(REPO, 'public');
const MASCOT = path.join(REPO, 'assets/brand/mascot/townmouse-aristocrat.png');
const mascotData = `data:image/png;base64,${fs.readFileSync(MASCOT).toString('base64')}`;
const PAPER = '#eef1f5';

// Every favicon/app/PWA icon uses the owner's bust portrait, uncropped, scaled
// with object-fit: contain. The SVG icon
// (assets/brand/mascot/townmouse-icon.svg) embeds the same portrait at 256px.
// Apple touch and maskable icons get the paper ground so iOS and Android do not
// composite transparent corners onto black.
const TARGETS = [
  ['favicon-16x16.png', 16, false],
  ['favicon-32x32.png', 32, false],
  ['icon-48.png', 48, false],
  ['icon-128.png', 128, false],
  ['icon-180.png', 180, false],
  ['apple-touch-icon.png', 180, true],
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-512-maskable.png', 512, true],
];

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const [name, size, grounded] of TARGETS) {
      const page = await browser.newPage();
      await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      const inset = name === 'icon-512-maskable.png' ? '80%' : '100%';
      await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:${grounded ? PAPER : 'transparent'};display:flex;align-items:center;justify-content:center}img{width:${inset};height:${inset};object-fit:contain}</style><img src="${mascotData}" alt="">`);
      await page.screenshot({ path: path.join(ROOT, name), omitBackground: !grounded });
      await page.close();
      console.log(`wrote ${name} (${size}x${size}, bust portrait)`);
    }
  } finally {
    await browser.close();
  }
})();
