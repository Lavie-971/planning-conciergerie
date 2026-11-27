/* Correctif de l'éditeur de blocs (aperçu privé ?preview=1).
   À charger APRÈS le script principal : <script src="editeur-blocs-fix.js"></script> juste avant </body>. */
(function () {
  'use strict';
  if (window.__editeurBlocsFix) return;
  window.__editeurBlocsFix = true;

  const SECTIONS = { hero: '.hero', intro: '.intro', listings: '.listings', destination: '.experience', contact: '.contact', footer: 'footer' };
  const FONTS = ['Arial', 'Georgia', 'Verdana', 'Tahoma', 'Times New Roman', 'Courier New'];
  const TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'A', 'DIV', 'FONT']);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const escT = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = s => escT(s).replace(/"/g, '&quot;');
  const status = m => { const el = document.querySelector('#customInlineToolbar [data-inline-status]'); if (el) el.textContent = m; };
  const ex = (c, v) => document.execCommand(c, false, v);

  /* ---------- 1. Nettoyage du texte : conserve gras, italique, souligné, taille, couleur, police, alignement, liens ---------- */
  function toHex(v) {
    v = String(v || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toLowerCase();
    const m = v.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+[\d.%]+)?\s*\)$/i);
    return m ? '#' + [m[1], m[2], m[3]].map(n => clamp(+n, 0, 255).toString(16).padStart(2, '0')).join('') : '';
  }
  function normSize(v) {
    v = String(v || '').trim().toLowerCase();
    const kw = { 'xx-small': 10, 'x-small': 12, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48, '-webkit-xxx-large': 48 };
    if (kw[v]) return kw[v];
    const m = v.match(/^(\d+(?:\.\d+)?)px$/);
    if (m) { const n = Math.round(+m[1]); if (n >= 8 && n <= 80) return n; }
    return 0;
  }
  function matchFont(v) {
    const first = String(v || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    return FONTS.find(f => f.toLowerCase() === first) || '';
  }
  function cssOf(n) {
    const out = [], s = n.style;
    if (!s) return out;
    const c = toHex(s.color); if (c) out.push('color:' + c);
    const fs = normSize(s.fontSize); if (fs) out.push('font-size:' + fs + 'px');
    const ff = matchFont(s.fontFamily); if (ff) out.push("font-family:'" + ff + "'");
    if (/^(left|center|right|justify)$/.test(s.textAlign)) out.push('text-align:' + s.textAlign);
    const fw = s.fontWeight; if (fw === 'bold' || fw === 'bolder' || +fw >= 600) out.push('font-weight:700');
    if (s.fontStyle === 'italic' || s.fontStyle === 'oblique') out.push('font-style:italic');
    const td = s.textDecorationLine || s.textDecoration || '', dec = [];
    if (/underline/.test(td)) dec.push('underline');
    if (/line-through/.test(td)) dec.push('line-through');
    if (dec.length) out.push('text-decoration:' + dec.join(' '));
    return out;
  }
  function walk(node) {
    let html = '';
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { html += escT(n.nodeValue || ''); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      if (!TAGS.has(tag)) { html += walk(n); return; }
      if (tag === 'BR') { html += '<br>'; return; }
      const css = cssOf(n);
      let name = tag === 'DIV' ? 'p' : tag === 'STRIKE' ? 's' : tag.toLowerCase(), attrs = '';
      if (tag === 'FONT') {
        name = 'span';
        const c = toHex(n.getAttribute('color')); if (c) css.push('color:' + c);
        const f = matchFont(n.getAttribute('face')); if (f) css.push("font-family:'" + f + "'");
        const z = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 }[n.getAttribute('size')]; if (z) css.push('font-size:' + z + 'px');
      }
      if (tag === 'A') {
        const href = (n.getAttribute('href') || '').trim();
        if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) { html += walk(n); return; }
        attrs = ' href="' + escA(href) + '"' + (/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '');
      }
      const inner = walk(n);
      if (!inner && /^(span|b|strong|i|em|u|s|a)$/.test(name)) return;
      html += '<' + name + attrs + (css.length ? ' style="' + css.join(';') + '"' : '') + '>' + inner + '</' + name + '>';
    });
    return html;
  }
  window.sanitizeCustomTextHtml = function (value) {
    return walk(new DOMParser().parseFromString('<body>' + String(value || '') + '</body>', 'text/html').body);
  };

  /* ---------- 2. Rendu : texte non éditable côté visiteur, bloc « image seule » ---------- */
  const baseRender = window.renderCustomSiteBlocks;
  window.renderCustomSiteBlocks = function () {
    const r = baseRender.apply(this, arguments);
    const editing = document.body.classList.contains('custom-inline-editing');
    document.querySelectorAll('.custom-site-block-canvas').forEach(box => {
      const txt = box.querySelector('[data-custom-text]');
      if (txt && !editing) txt.removeAttribute('contenteditable');
      box.classList.toggle('custom-image-only', !!box.querySelector('.custom-site-block-image') && (!txt || !txt.textContent.trim()));
    });
    return r;
  };

  /* ---------- 3. Sélection de texte conservée quand on clique dans la barre d'outils ---------- */
  let saved = null, savedEditor = null;
  const editorOf = node => { const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest ? el.closest('[data-custom-text]') : null; };
  document.addEventListener('selectionchange', () => {
    if (!document.body.classList.contains('custom-inline-editing')) return;
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0), ed = editorOf(r.commonAncestorContainer);
    if (ed) { saved = r.cloneRange(); savedEditor = ed; }
  });
  document.addEventListener('focusin', e => { if (editorOf(e.target)) { try { ex('defaultParagraphSeparator', 'p'); } catch (_) {} } });

  function activeEditor() {
    const sel = window.customInlineSelectedText && customInlineSelectedText();
    if (sel && savedEditor !== sel) { saved = null; savedEditor = sel; }
    return savedEditor && savedEditor.isConnected ? savedEditor : sel;
  }
  function fmt(fn, whole) {
    const ed = activeEditor();
    if (!ed) { status('Cliquez d’abord dans un texte.'); return; }
    ed.contentEditable = 'true';
    ed.focus({ preventScroll: true });
    const sel = getSelection();
    if (saved && ed.contains(saved.commonAncestorContainer)) { sel.removeAllRanges(); sel.addRange(saved); }
    else { sel.selectAllChildren(ed); sel.collapseToEnd(); }
    if (whole && sel.isCollapsed) sel.selectAllChildren(ed);
    try { ex('defaultParagraphSeparator', 'p'); } catch (_) {}
    fn(ed);
    customInlineMarkDirty();
  }
  function applySize(px) {
    fmt(ed => {
      ex('styleWithCSS', false);
      ex('fontSize', '7');
      ed.querySelectorAll('font[size="7"]').forEach(f => {
        const s = document.createElement('span');
        s.style.fontSize = px;
        while (f.firstChild) s.appendChild(f.firstChild);
        s.querySelectorAll('[style]').forEach(x => x.style.removeProperty('font-size'));
        f.replaceWith(s);
      });
      ed.querySelectorAll('span').forEach(s => { if (/xxx-large/.test(s.style.fontSize)) s.style.fontSize = px; });
    }, true);
  }

  /* ---------- 4. Création de blocs (texte, image, lien), placés dans la section visible ---------- */
  function visibleSection() {
    const cy = innerHeight / 2;
    for (const [key, sel] of Object.entries(SECTIONS)) {
      const a = document.querySelector(sel); if (!a) continue;
      const r = a.getBoundingClientRect();
      if (r.height > 0 && r.top <= cy && r.bottom >= cy) return { key, anchor: a };
    }
    return { key: 'intro', anchor: document.querySelector(SECTIONS.intro) || document.querySelector(SECTIONS.hero) };
  }
  function newBlock(wPct, hPx) {
    const t = visibleSection(), a = t.anchor, r = a.getBoundingClientRect();
    const cw = Math.max(1, a.clientWidth), ch = Math.max(1, a.clientHeight), w = cw * wPct / 100;
    const left = innerWidth / 2 - w / 2 - (r.left + a.clientLeft), top = innerHeight / 2 - hPx / 2 - (r.top + a.clientTop);
    return {
      id: crypto.randomUUID(), type: 'mixed', title: '', text: '', text_html: '<p><br></p>', image_url: '', link_url: '', link_label: 'En savoir plus',
      placement: { mode: 'canvas', target: t.key, x: clamp(left / cw * 100, 0, 100 - wPct), y: clamp(top / ch * 100, 0, Math.max(0, 100 - hPx / ch * 100)), width: wPct, height: hPx }
    };
  }
  function pushBlock(b, focus) {
    customInlineEditor.blocks.push(b);
    customInlineEditor.selectedId = b.id;
    customInlineRender();
    if (focus) customInlineFocusText(b.id);
    customInlineMarkDirty();
    status('Bloc ajouté — déplacez-le avec ✥, puis Enregistrer.');
  }
  function pickImage() {
    return new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp,image/gif'; i.style.display = 'none';
      i.addEventListener('change', () => { res(i.files && i.files[0] || null); setTimeout(() => i.remove(), 0); });
      i.addEventListener('cancel', () => { res(null); i.remove(); });
      document.body.appendChild(i); i.click();
    });
  }
  async function addBlock(kind) {
    try {
      if (kind === 'text') { pushBlock(newBlock(40, 160), true); return; }
      if (kind === 'image') {
        const file = await pickImage(); if (!file) return;
        status('Envoi de l’image…');
        const b = newBlock(35, 260); b.image_url = await uploadSiteImage(file);
        pushBlock(b, false); return;
      }
      if (kind === 'link') {
        const url = prompt('Adresse du lien (https://…, mailto:, tel:)'); if (!url) return;
        const href = safeCustomBlockUrl(url), label = prompt('Texte du bouton', 'En savoir plus');
        const b = newBlock(25, 90); b.link_url = href; b.link_label = (label || 'En savoir plus').trim();
        pushBlock(b, false);
      }
    } catch (err) { status('Erreur : ' + (err.message || err)); }
  }

  /* ---------- 5. Barre d'outils (toujours visible en mode édition) ---------- */
  const BAR = '<strong>Édition du site</strong>'
    + '<button type="button" data-add="text" title="Ajouter une zone de texte">＋ Texte</button>'
    + '<button type="button" data-add="image" title="Ajouter une image">＋ Image</button>'
    + '<button type="button" data-add="link" title="Ajouter un bouton-lien">＋ Lien</button>'
    + '<button type="button" data-draw title="Dessiner un rectangle sur la page">▭ Dessiner</button>'
    + '<button type="button" data-inline-command="bold" title="Gras"><b>G</b></button>'
    + '<button type="button" data-inline-command="italic" title="Italique"><i>I</i></button>'
    + '<button type="button" data-inline-command="underline" title="Souligné"><u>U</u></button>'
    + '<button type="button" data-inline-command="strikeThrough" title="Barré"><s>S</s></button>'
    + '<select data-inline-font-size title="Taille du texte">' + [12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map(n => '<option value="' + n + 'px"' + (n === 16 ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>'
    + '<select data-inline-font title="Police">' + FONTS.map(f => '<option>' + f + '</option>').join('') + '</select>'
    + '<input type="color" data-inline-color title="Couleur du texte" value="#173f36">'
    + '<button type="button" data-inline-align="Left" title="Aligner à gauche">⇤</button>'
    + '<button type="button" data-inline-align="Center" title="Centrer">↔</button>'
    + '<button type="button" data-inline-align="Right" title="Aligner à droite">⇥</button>'
    + '<button type="button" data-text-link title="Lien sur le texte sélectionné">🔗</button>'
    + '<button type="button" data-clear title="Effacer la mise en forme">Tₓ</button>'
    + '<button type="button" data-inline-delete title="Supprimer le bloc sélectionné">Supprimer le bloc</button>'
    + '<button type="button" data-inline-save class="save">Enregistrer</button>'
    + '<button type="button" data-inline-exit title="Quitter l’édition">✕</button><span data-inline-status></span>';

  window.customInlineToolbar = function () {
    let bar = document.getElementById('customInlineToolbar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'customInlineToolbar'; bar.className = 'custom-inline-toolbar'; bar.innerHTML = BAR;
    document.body.appendChild(bar);
    bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    bar.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = b.dataset;
      if (d.add) { addBlock(d.add); return; }
      if ('draw' in d) { document.getElementById('customInsertPencil')?.click(); return; }
      if (d.inlineCommand) { fmt(() => { ex('styleWithCSS', false); ex(d.inlineCommand); }); return; }
      if (d.inlineAlign) { fmt(() => { ex('styleWithCSS', true); ex('justify' + d.inlineAlign); }, true); return; }
      if ('textLink' in d) {
        let u = (prompt('Adresse du lien (https://…, mailto:, tel:)') || '').trim(); if (!u) return;
        if (/^www\./i.test(u)) u = 'https://' + u;
        if (!/^(https?:\/\/|mailto:|tel:)/i.test(u)) { status('Lien invalide.'); return; }
        fmt(() => { if (getSelection().isCollapsed) ex('insertHTML', '<a href="' + escA(u) + '">' + escT(u) + '</a>'); else ex('createLink', u); });
        return;
      }
      if ('clear' in d) { fmt(() => ex('removeFormat'), true); return; }
      if ('inlineDelete' in d) { customInlineDeleteSelected(); return; }
      if ('inlineSave' in d) { customInlineSave(); return; }
      if ('inlineExit' in d) customInlineExit();
    });
    bar.addEventListener('change', e => {
      if (e.target.matches('[data-inline-font-size]')) applySize(e.target.value);
      else if (e.target.matches('[data-inline-font]')) { const v = e.target.value; fmt(() => { ex('styleWithCSS', true); ex('fontName', v); }, true); }
      else if (e.target.matches('[data-inline-color]')) { const v = e.target.value; fmt(() => { ex('styleWithCSS', true); ex('foreColor', v); }, true); }
    });
    return bar;
  };
  window.customInlineUpdateSelectionUI = function () {
    const bar = document.getElementById('customInlineToolbar'); if (bar) bar.hidden = false;
    document.querySelectorAll('.custom-site-block-canvas,[data-custom-block-id]').forEach(box => {
      const id = box.dataset.customCanvasId || box.dataset.customBlockId;
      box.classList.toggle('custom-block-selected', !!customInlineEditor.selectedId && id === customInlineEditor.selectedId);
    });
  };
  // Le crayon « ＋ » ouvre d'abord l'éditeur (barre d'outils), puis dessine un rectangle comme avant.
  document.addEventListener('click', e => {
    if (!e.target.closest || !e.target.closest('#customInsertPencil') || document.body.classList.contains('custom-inline-editing')) return;
    e.stopImmediatePropagation(); e.preventDefault(); openCustomBlocksManager();
  }, true);

  /* ---------- 6. Poignées : déplacer partout (✥) et supprimer (✕) ---------- */
  function dropBlock(b, fr) {
    const cy = fr.top + fr.height / 2; let best = null, dist = 1e9;
    for (const [key, sel] of Object.entries(SECTIONS)) {
      const a = document.querySelector(sel); if (!a) continue;
      const r = a.getBoundingClientRect(); if (r.height <= 0) continue;
      const dd = cy >= r.top && cy <= r.bottom ? 0 : Math.min(Math.abs(cy - r.top), Math.abs(cy - r.bottom));
      if (dd < dist) { dist = dd; best = { key, anchor: a }; }
    }
    if (!best) return;
    const a = best.anchor, ar = a.getBoundingClientRect(), cw = Math.max(1, a.clientWidth), ch = Math.max(1, a.clientHeight);
    const w = clamp(fr.width / cw * 100, 10, 100), h = clamp(fr.height, 60, 1600);
    b.placement = { ...(b.placement || {}), mode: 'canvas', target: best.key, width: w, height: h,
      x: clamp((fr.left - (ar.left + a.clientLeft)) / cw * 100, 0, 100 - w),
      y: clamp((fr.top - (ar.top + a.clientTop)) / ch * 100, 0, Math.max(0, 100 - h / ch * 100)) };
  }
  function startDrag(box, e) {
    e.preventDefault(); e.stopPropagation();
    customInlineSyncFromPage();
    const b = customInlineEditor.blocks.find(x => x.id === box.dataset.customCanvasId); if (!b) return;
    customInlineEditor.selectedId = b.id; customInlineUpdateSelectionUI();
    const r = box.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    (document.getElementById('publicApp') || document.body).appendChild(box);
    Object.assign(box.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', zIndex: '29000' });
    const move = ev => { box.style.left = (ev.clientX - ox) + 'px'; box.style.top = (ev.clientY - oy) + 'px'; };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      dropBlock(b, box.getBoundingClientRect());
      customInlineMarkDirty(); customInlineRender();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }
  function addHandles(box) {
    if (box.querySelector('.custom-drag-handle')) return;
    const drag = document.createElement('span'); drag.className = 'custom-drag-handle'; drag.contentEditable = 'false'; drag.title = 'Déplacer le bloc'; drag.textContent = '✥';
    const del = document.createElement('span'); del.className = 'custom-delete-handle'; del.contentEditable = 'false'; del.title = 'Supprimer ce bloc'; del.textContent = '✕';
    drag.addEventListener('pointerdown', e => startDrag(box, e));
    drag.addEventListener('click', e => e.stopPropagation());
    del.addEventListener('pointerdown', e => e.stopPropagation());
    del.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); customInlineEditor.selectedId = box.dataset.customCanvasId; customInlineDeleteSelected(); });
    box.appendChild(drag); box.appendChild(del);
  }
  const baseAttach = window.customInlineAttachInteractions;
  window.customInlineAttachInteractions = function () {
    const r = baseAttach.apply(this, arguments);
    document.querySelectorAll('.custom-site-block-canvas').forEach(addHandles);
    return r;
  };

  const css = document.createElement('style');
  css.textContent = '.custom-drag-handle,.custom-delete-handle{position:absolute;top:-1px;z-index:25;width:30px;height:28px;display:none;align-items:center;justify-content:center;font:700 15px Arial,sans-serif;touch-action:none;user-select:none}'
    + '.custom-drag-handle{left:-1px;background:#d5a64c;color:#173f36;cursor:grab;border-radius:0 0 8px 0}'
    + '.custom-delete-handle{right:-1px;background:#b83a3a;color:#fff;cursor:pointer;border-radius:0 0 0 8px}'
    + 'body.custom-inline-editing .custom-site-block-canvas:hover>.custom-drag-handle,body.custom-inline-editing .custom-site-block-canvas:hover>.custom-delete-handle,'
    + 'body.custom-inline-editing .custom-block-selected>.custom-drag-handle,body.custom-inline-editing .custom-block-selected>.custom-delete-handle{display:flex}'
    + '.custom-site-block-canvas.custom-image-only .custom-site-block-image{height:calc(100% - 40px)}';
  document.head.appendChild(css);
})();