import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refocusWhenLost } from '../refocus';

let queue: FrameRequestCallback[] = [];
const frame = () => { const run = queue; queue = []; run.forEach((cb) => cb(0)); };

beforeEach(() => {
  queue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('refocusWhenLost', () => {
  it('rend le focus à l\'élément visé quand il est tombé sur le fond, même s\'il apparaît plus tard', () => {
    refocusWhenLost('#cible');
    frame(); // pas encore là
    const cible = document.createElement('button');
    cible.id = 'cible';
    document.body.appendChild(cible);
    frame();
    expect(document.activeElement).toBe(cible);
  });

  it('ne reprend rien si le focus est déjà ailleurs', () => {
    const autre = document.createElement('button');
    const cible = document.createElement('button');
    cible.id = 'cible';
    document.body.append(autre, cible);
    autre.focus();
    refocusWhenLost('#cible');
    frame();
    expect(document.activeElement).toBe(autre);
  });
});
