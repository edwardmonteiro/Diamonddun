import Phaser from 'phaser';
import '@fontsource/outfit/200.css';
import '@fontsource/outfit/300.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/700.css';
import { SIZE, PHYS } from './config.js';
import Boot from './scenes/Boot.js';
import Title from './scenes/Title.js';
import Game from './scenes/Game.js';
import Studio from './scenes/Studio.js';

async function start() {
  try {
    await Promise.all([200, 300, 500, 700].map((w) => document.fonts.load(`${w} 32px Outfit`)));
  } catch {
    /* fall back to system font */
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: SIZE.CW,
    height: SIZE.CH,
    backgroundColor: '#05061a',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, powerPreference: 'high-performance' },
    fps: { target: 60, smoothStep: true },
    input: { activePointers: 3 },
    audio: { disableWebAudio: false },
    physics: {
      default: 'arcade',
      arcade: { gravity: { y: PHYS.gravity }, fps: 60, debug: false },
    },
    scene: [Boot, Title, Game, Studio],
  });
  window.__game = game;
  if (/[?&]llmtest\b/.test(location.search)) import('./ai/llm-selftest.js').then((m) => m.install());
}

start();
