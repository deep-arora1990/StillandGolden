// The portfolio page's tab buttons and photo grid, written from
// data/portfolio.json. build/render.js fills portfolio.html's two mounts with
// these (<!-- include:portfolio-tabs --> and <!-- include:portfolio-grid -->),
// and build.js ships this file inside dist/_cms/render.js so Studio's preview
// writes the grid the same way. So: no Node APIs here.
//
// The markup is the page's hand-written markup, byte for byte: the first photo
// of each tab loads eagerly and the rest lazily, and the reveal delay cycles
// reveal, d1, d2, d3 from each tab's first photo. Paths are repo paths, written
// through encodeURI ("DSC09027 1.jpg" becomes "DSC09027%201.jpg"), which also
// leaves no quote or angle bracket to escape. Labels and captions are HTML and
// go in as they are; descriptions are plain text, escaped.

const INSTAGRAM = ' &nbsp;&middot;&nbsp; <a href="https://www.instagram.com/stillandgoldenphotography" target="_blank" rel="noopener">@stillandgoldenphotography</a></p>';
const REVEAL = ['reveal', 'reveal d1', 'reveal d2', 'reveal d3'];

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderTabs(data) {
  return data.tabs
    .map((t, i) => `<button class="port-tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`)
    .join('\n      ');
}

function renderPhoto(p, i) {
  return `    <div class="masonry-item ${REVEAL[i % 4]}"><picture>`
    + `<source srcset="${encodeURI(p.webp)}" type="image/webp">`
    + `<img decoding="async" width="${p.width}" height="${p.height}" src="${encodeURI(p.jpg)}" alt="${attr(p.alt)}"${i === 0 ? '' : ' loading="lazy"'}>`
    + '</picture></div>';
}

function renderGrid(data) {
  return data.tabs.map((t, i) => [
    `<div id="tab-${t.id}" class="port-section${i === 0 ? ' visible' : ''}">`,
    '      <div class="masonry">',
    ...t.photos.map(renderPhoto),
    '      </div>',
    `      <p class="grid-caption">${t.caption}${INSTAGRAM}`,
    '    </div>',
  ].join('\n')).join('\n\n    ');
}

// The rules data/portfolio.json must meet before the site is built. The build
// refuses anything else, so a broken entry never reaches the live page, and
// Studio gets the same rules as SGRender.checkPortfolio.
//   jpg   <parent>/web/<name>.jpg or .JPG (the parent is usually the tab's own
//         folder, but a photo can come from another tab's)
//   webp  <parent>/webp/<name>.webp, the same parent and name
//   width, height  whole numbers from 1 to 1600 (the long edge is 1600)
//   alt   a description, not empty
//   no path may still say upload: (a photo Studio hasn't uploaded yet)
function checkPortfolio(data) {
  const fail = (what) => { throw new Error(`data/portfolio.json: ${what}`); };
  if (!data || data.version !== 1 || !Array.isArray(data.tabs)) fail('expected { "version": 1, "tabs": [...] }');
  if (data.tabs.length === 0) fail('no tabs');
  const ids = new Set();
  data.tabs.forEach((t, ti) => {
    if (!t || typeof t.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.id)) {
      fail(`tab ${ti + 1}: the id must be lower-case letters, digits and hyphens`);
    }
    if (ids.has(t.id)) fail(`tab ${ti + 1} ("${t.id}"): the id "${t.id}" is used twice`);
    ids.add(t.id);
    const tab = `tab "${t.id}"`;
    for (const key of ['label', 'folder', 'caption']) {
      if (typeof t[key] !== 'string' || !t[key].trim()) fail(`${tab}: no ${key}`);
    }
    if (t.folder.includes('upload:')) fail(`${tab}: the folder says upload:`);
    if (!Array.isArray(t.photos) || t.photos.length === 0) fail(`${tab}: no photos`);
    t.photos.forEach((p, pi) => {
      const at = `${tab} photo ${pi + 1}`;
      if (!p || typeof p.jpg !== 'string' || typeof p.webp !== 'string') fail(`${at}: jpg and webp must be paths`);
      if (p.jpg.includes('upload:') || p.webp.includes('upload:')) {
        fail(`${at}: still waiting to upload (a path says upload:)`);
      }
      const jpg = p.jpg.match(/^(.+)\/web\/([^/]+)\.(?:jpg|JPG)$/);
      if (!jpg) fail(`${at}: jpg "${p.jpg}" must be in a web/ folder and end .jpg or .JPG`);
      const webp = `${jpg[1]}/webp/${jpg[2]}.webp`;
      if (p.webp !== webp) fail(`${at}: webp "${p.webp}" must be "${webp}"`);
      for (const key of ['width', 'height']) {
        const n = p[key];
        if (!Number.isInteger(n) || n < 1 || n > 1600) fail(`${at}: ${key} must be a whole number from 1 to 1600`);
      }
      if (typeof p.alt !== 'string' || !p.alt.trim()) fail(`${at}: no description (alt)`);
    });
  });
}

module.exports = { renderTabs, renderGrid, checkPortfolio };
