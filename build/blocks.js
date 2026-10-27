// Block markers: pages are split into typed blocks with HTML comments, which
// the Studio editor reads and patches. The build validates them, then strips
// them, so published pages never contain a marker. Not served (see build.js).
//
//   <!-- block:<type> <id> -->  ...  <!-- /block -->
//
// type: /^[a-z][a-z-]*$/   id: /^[a-z][a-z0-9-]*$/, unique per page. Flat only.
//
// Offsets are JS string indices (UTF-16), not bytes: decode a file to a string
// before slicing or patching with them.

const LIBRARY = require('../blocks/library.json');

const TYPE_RE = /^[a-z][a-z-]*$/;
const ID_RE = /^[a-z][a-z0-9-]*$/;
// Anything shaped like a block marker. Loose on purpose, so a malformed one is
// reported rather than ignored; the exact syntax is checked below.
const MARKER_RE = /<!--\s*\/?block\b[^>]*?-->/g;
const CLOSE_RE = /^<!--\s*\/block\s*-->$/;
const OPEN_RE = /^<!--\s*block:([^\s]*)(?:[ \t]+([^\s]*))?\s*-->$/;

const lineOf = (html, at) => html.slice(0, at).split('\n').length;

function parseBlocks(html) {
  const blocks = [];
  const seen = new Set();
  let open = null;
  MARKER_RE.lastIndex = 0;
  let m;
  while ((m = MARKER_RE.exec(html))) {
    const span = [m.index, m.index + m[0].length];
    const line = lineOf(html, m.index);
    const close = CLOSE_RE.test(m[0]);
    const om = close ? null : OPEN_RE.exec(m[0]);
    if (!close && !om) throw new Error(`malformed block marker "${m[0]}" on line ${line}`);
    if (close) {
      if (!open) throw new Error(`line ${line}: closing block marker without an opening one`);
      blocks.push({ type: open.type, id: open.id, open: open.span, close: span, inner: [open.span[1], span[0]] });
      open = null;
      continue;
    }
    const [, type, id] = om;
    if (open) throw new Error(`line ${line}: nested block "${id}" inside "${open.id}" (blocks are flat)`);
    if (!TYPE_RE.test(type)) throw new Error(`line ${line}: bad block type "${type}" (lowercase letters and hyphens)`);
    if (id === undefined || !ID_RE.test(id)) throw new Error(`line ${line}: bad block id "${id === undefined ? '' : id}" (lowercase letters, digits and hyphens, starting with a letter)`);
    if (seen.has(id)) throw new Error(`line ${line}: duplicate block id "${id}"`);
    seen.add(id);
    open = { type, id, span, line };
  }
  if (open) throw new Error(`line ${open.line}: unclosed block "${open.id}"`);
  return blocks;
}

// Removes every marker. A marker alone on its line takes the whole line with it
// (indentation and its own \n or \r\n), so the page is byte-for-byte what it
// was before the markers went in.
function stripBlockMarkers(html) {
  const spans = [];
  for (const b of parseBlocks(html)) spans.push(b.open, b.close);
  let out = '';
  let pos = 0;
  for (const [s, e] of spans) {
    let from = s, to = e;
    const ls = html.lastIndexOf('\n', s - 1) + 1;
    const nl = /^[ \t]*(\r?\n|$)/.exec(html.slice(e));
    if (/^[ \t]*$/.test(html.slice(ls, s)) && nl) { from = ls; to = e + nl[0].length; }
    if (from < pos) throw new Error('overlapping block markers');
    out += html.slice(pos, from);
    pos = to;
  }
  return out + html.slice(pos);
}

module.exports = { parseBlocks, stripBlockMarkers, LIBRARY };
