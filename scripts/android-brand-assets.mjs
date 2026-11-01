/**
 * android-brand-assets.mjs — Icône et bannière Android générées depuis la charte Nyx Player.
 *
 *   node scripts/android-brand-assets.mjs
 *
 * Sources (docs/Nyx Player branding/LOGOTYPES) :
 * - LOGO APP DÉGRADÉ.svg : son image de dégradé (sans le symbole) devient le fond de l'icône
 * - ICOTYPE BLANC.svg    : le symbole, en vectoriel, devant le fond (et icône à thème Android 13+)
 * - LOGO PRINCIPAL BLANC : symbole + « Nyx Player », au centre de la bannière TV
 *
 * Pourquoi pas `tauri icon` : il pose le logo carré entier comme calque avant. Les lanceurs qui
 * découpent l'icône en rond (Pixel, Google TV) rognaient alors les coins du symbole. Ne pas le
 * relancer sur src-tauri/gen/android : il écraserait ces fichiers (l'icône Windows, elle, vient
 * de src-tauri/icons et n'est pas concernée).
 *
 * Fichiers produits dans src-tauri/gen/android/app/src/main/res :
 * - mipmap-*dpi/ic_launcher_background.png   fond (dégradé), 108 dp par densité
 * - drawable/ic_launcher_foreground.xml       symbole vectoriel
 * - mipmap-anydpi-v26/ic_launcher.xml         icône adaptative
 * - drawable/nyx_wordmark.xml                 logo principal vectoriel
 * - drawable/tv_banner.xml                    bannière du lanceur Android TV (320 × 180 dp)
 */

import fs from 'node:fs';
import zlib from 'node:zlib';

const BRAND = 'docs/Nyx Player branding/LOGOTYPES';
const RES = 'src-tauri/gen/android/app/src/main/res';

/** Coins arrondis blancs de l'image de dégradé : recadrés (pixels de la source) */
const GRADIENT_INSET = 24;
/** Hauteur du symbole dans l'icône (dp sur 108) : proche de l'icône Windows, dans la zone sûre de 66 dp */
const GLYPH_HEIGHT_DP = 40;
/** Largeur du logo principal dans la bannière (dp sur 320) */
const WORDMARK_WIDTH_DP = 232;

// ---------------------------------------------------------------------------
// PNG : décodage (RGB/RGBA 8 bits), réduction par moyenne, encodage RGB
// ---------------------------------------------------------------------------

function decodePng(buf) {
  let pos = 8, width, height, bitDepth, colorType;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('PNG entrelacé non géré');
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`format non géré ${bitDepth}/${colorType}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = 0; break;
        case 1: v = a; break;
        case 2: v = b; break;
        case 3: v = (a + b) >> 1; break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
        default: throw new Error('filtre ' + filter);
      }
      line[i] = (line[i] + v) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = line[x * bpp];
      out[(y * width + x) * 4 + 1] = line[x * bpp + 1];
      out[(y * width + x) * 4 + 2] = line[x * bpp + 2];
      out[(y * width + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width, height, pixels: out };
}

// Réduction par moyenne de zone (le dégradé est très lisse, aucun crénelage)
function resample(src, sx, sy, sw, sh, size) {
  const out = Buffer.alloc(size * size * 3);
  const scale = sw / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = sx + x * scale, y0 = sy + y * scale;
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y0 + scale); yy++) {
        for (let xx = Math.floor(x0); xx < Math.ceil(x0 + scale); xx++) {
          const i = (yy * src.width + xx) * 4;
          r += src.pixels[i]; g += src.pixels[i + 1]; b += src.pixels[i + 2]; n++;
        }
      }
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePngRgb(rgb, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// SVG simple (path, polygon, rect) → pathData Android
// ---------------------------------------------------------------------------

function svgPaths(svg) {
  const paths = [];
  const tags = /<(path|polygon|rect)\b([^>]*)\/?>/g;
  let match;
  while ((match = tags.exec(svg))) {
    const [, tag, attrs] = match;
    const attr = (name) => (attrs.match(new RegExp('[ ]' + name + '="([^"]*)"')) || [])[1];
    if (tag === 'path') paths.push(attr('d'));
    else if (tag === 'polygon') {
      const n = attr('points').trim().split(/[\s,]+/);
      const points = [];
      for (let i = 0; i < n.length; i += 2) points.push(`${n[i]},${n[i + 1]}`);
      paths.push(`M${points[0]}L${points.slice(1).join(' ')}Z`);
    } else {
      const x = attr('x') || '0';
      const y = attr('y') || '0';
      paths.push(`M${x},${y}h${attr('width')}v${attr('height')}h-${attr('width')}Z`);
    }
  }
  return paths;
}

const viewBox = (svg) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
const write = (file, content) => fs.writeFileSync(`${RES}/${file}`, content);

// ---- Fond de l'icône : le dégradé du logo de l'app ----
const appSvg = fs.readFileSync(`${BRAND}/LOGO APP/SVG/LOGO APP DÉGRADÉ.svg`, 'utf8');
const gradientBase64 = appSvg.match(/xlink:href="data:image\/png;base64,([^"]+)"/)[1].replace(/\s+/g, '');
const gradient = decodePng(Buffer.from(gradientBase64, 'base64'));
const side = Math.min(gradient.width, gradient.height) - 2 * GRADIENT_INSET;
for (const [density, size] of Object.entries({ mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 })) {
  const pixels = resample(gradient, GRADIENT_INSET, GRADIENT_INSET, side, side, size);
  fs.writeFileSync(`${RES}/mipmap-${density}/ic_launcher_background.png`, encodePngRgb(pixels, size));
}

// ---- Symbole : calque avant et icône à thème ----
const icoSvg = fs.readFileSync(`${BRAND}/ICOTYPE/SVG/ICOTYPE BLANC.svg`, 'utf8');
const [iw, ih] = viewBox(icoSvg);
const scale = GLYPH_HEIGHT_DP / ih;
const glyphPaths = svgPaths(icoSvg)
  .map((d) => `        <path\n            android:fillColor="#FFFFFFFF"\n            android:pathData="${d}" />`)
  .join('\n');
write('drawable/ic_launcher_foreground.xml', `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré par scripts/android-brand-assets.mjs : symbole Nyx (ICOTYPE), calque avant et icône à thème -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:scaleX="${scale.toFixed(6)}"
        android:scaleY="${scale.toFixed(6)}"
        android:translateX="${((108 - iw * scale) / 2).toFixed(3)}"
        android:translateY="${((108 - GLYPH_HEIGHT_DP) / 2).toFixed(3)}">
${glyphPaths}
    </group>
</vector>
`);

fs.mkdirSync(`${RES}/mipmap-anydpi-v26`, { recursive: true });
write('mipmap-anydpi-v26/ic_launcher.xml', `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré par scripts/android-brand-assets.mjs (ne pas utiliser tauri icon) : dégradé du logo en fond,
     symbole vectoriel devant ; le lanceur découpe la forme (rond, carré arrondi…) -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`);

// ---- Bannière Android TV : dégradé + logo principal ----
const wordmarkSvg = fs.readFileSync(`${BRAND}/LOGO PRINCIPAL/SVG/LOGO PRINCIPAL BLANC.svg`, 'utf8');
const [ww, wh] = viewBox(wordmarkSvg);
const wordmarkHeightDp = +(WORDMARK_WIDTH_DP * wh / ww).toFixed(2);
const wordmarkPaths = svgPaths(wordmarkSvg)
  .map((d) => `    <path\n        android:fillColor="#FFFFFFFF"\n        android:pathData="${d}" />`)
  .join('\n');
write('drawable/nyx_wordmark.xml', `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré par scripts/android-brand-assets.mjs : logo principal Nyx Player (symbole + nom), blanc -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${WORDMARK_WIDTH_DP}dp"
    android:height="${wordmarkHeightDp}dp"
    android:viewportWidth="${ww}"
    android:viewportHeight="${wh}">
${wordmarkPaths}
</vector>
`);

write('drawable/tv_banner.xml', `<?xml version="1.0" encoding="utf-8"?>
<!--
  Généré par scripts/android-brand-assets.mjs. Bannière du lanceur Android TV (320 × 180 dp), pour
  les écrans d'accueil qui affichent les applis en tuiles : dégradé du logo de l'app (étiré en 16:9)
  et logo principal blanc, vectoriel pour rester net sur toutes les TV. Google TV affiche l'icône ronde.
-->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <bitmap
            android:src="@mipmap/ic_launcher_background"
            android:gravity="fill" />
    </item>
    <item
        android:gravity="center"
        android:width="${WORDMARK_WIDTH_DP}dp"
        android:height="${wordmarkHeightDp}dp"
        android:drawable="@drawable/nyx_wordmark" />
</layer-list>
`);

console.log('Icône et bannière Android générées dans', RES);
