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
    if (ed) { saved = r.cloneRange(); savedEditor = ed; syncBar(); }
  });
  document.addEventListener('focusin', e => { if (editorOf(e.target)) { try { ex('defaultParagraphSeparator', 'p'); } catch (_) {} } });

  function syncBar() {
    const bar = document.getElementById('customInlineToolbar'); if (!bar || !saved) return;
    let el = saved.startContainer; el = el.nodeType === 1 ? el : el.parentElement; if (!el) return;
    const cs = getComputedStyle(el), sizeSel = bar.querySelector('[data-inline-font-size]'), fontSel = bar.querySelector('[data-inline-font]'), col = bar.querySelector('[data-inline-color]');
    const px = parseFloat(cs.fontSize) || 16, opts = [...sizeSel.options].map(o => parseInt(o.value, 10));
    sizeSel.value = opts.reduce((best, n) => Math.abs(n - px) < Math.abs(best - px) ? n : best, opts[0]) + 'px';
    const f = matchFont(cs.fontFamily); if (f) fontSel.value = f;
    const hx = toHex(cs.color); if (/^#[0-9a-f]{6}$/.test(hx)) col.value = hx;
    const al = cs.textAlign, alSel = bar.querySelector('[data-inline-align]');
    if (alSel) alSel.value = al === 'center' ? 'Center' : (al === 'right' || al === 'end') ? 'Right' : 'Left';
    ['bold', 'italic', 'underline'].forEach(c => {
      let on = false; try { on = document.queryCommandState(c); } catch (_) {}
      bar.querySelector('[data-inline-command="' + c + '"]')?.classList.toggle('on', !!on);
    });
  }

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

  /* ---------- 5. Interface simple : barre flottante près du bloc, menu « ＋ », pastille d'enregistrement ---------- */
  const BAR = '<button type="button" data-inline-command="bold" title="Gras"><b>G</b></button>'
    + '<button type="button" data-inline-command="italic" title="Italique"><i>I</i></button>'
    + '<button type="button" data-inline-command="underline" title="Souligné"><u>S</u></button>'
    + '<select data-inline-font-size title="Taille du texte">' + [12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map(n => '<option value="' + n + 'px"' + (n === 16 ? ' selected' : '') + '>' + n + ' px</option>').join('') + '</select>'
    + '<select data-inline-font title="Police">' + FONTS.map(f => '<option value="' + escA(f) + '" style="font-family:\'' + escA(f) + '\'">' + escT(f) + '</option>').join('') + '</select>'
    + '<label class="cit-color" title="Couleur du texte">Couleur <input type="color" data-inline-color value="#173f36"></label>'
    + '<select data-inline-align title="Alignement du texte"><option value="Left">Aligné à gauche</option><option value="Center">Centré</option><option value="Right">Aligné à droite</option></select>'
    + '<button type="button" data-text-link title="Transformer le texte sélectionné en lien">🔗 Lien</button>'
    + '<span class="cit-sep"></span>'
    + '<button type="button" data-inline-delete class="danger" title="Supprimer ce bloc">Supprimer</button>'
    + '<button type="button" data-inline-save class="save">Enregistrer</button>'
    + '<span data-inline-status hidden></span>';

  // Accepte les blocs récents (canvas) et les anciens blocs encore au format historique.
  const getBox = () => {
    const id = customInlineEditor.selectedId;
    if (!id) return null;
    const safeId = CSS.escape(id);
    return document.querySelector('.custom-site-block-canvas[data-custom-canvas-id="' + safeId + '"], [data-custom-block-id="' + safeId + '"]');
  };
  function positionBar(bar, box) {
    // La barre d'édition reste toujours en haut de l'écran, centrée,
    // quelle que soit la position de la case en cours de création.
    bar.style.top = '0px';
    bar.style.left = '50%';
    bar.style.transform = 'translateX(-50%)';
  }
  function refreshUI() {
    const bar = document.getElementById('customInlineToolbar'); if (!bar) return;
    const selected = !!(customInlineEditor && customInlineEditor.selectedId);
    const box = getBox();
    // À la création, le bloc peut être en cours de rendu : ne pas masquer
    // la barre tant qu'un identifiant de bloc reste sélectionné.
    bar.hidden = !selected;
    if (selected) {
      bar.style.display = 'flex';
      bar.style.visibility = 'visible';
      bar.style.opacity = '1';
      positionBar(bar, box);
    }
    const pill = document.getElementById('customSavePill');
    if (pill) pill.hidden = !(customInlineEditor.dirty && !selected);
  }
  let raf = 0;
  const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(refreshUI); };
  addEventListener('scroll', later, { passive: true });
  addEventListener('resize', later);

  function buildMenu() {
    if (document.getElementById('customAddMenu')) return;
    const m = document.createElement('div');
    m.id = 'customAddMenu'; m.className = 'cit-menu'; m.hidden = true;
    m.innerHTML = '<p>Ajouter à la page</p>'
      + '<button type="button" data-add="image"><b>🖼</b> Image</button>'
      + '<button type="button" data-add="link"><b>🔗</b> Bouton-lien</button>'
      + '<button type="button" data-draw><b>▭</b> Dessiner la zone de mon choix</button>'
      + '<hr><button type="button" data-inline-exit>Quitter l’édition</button>';
    document.body.appendChild(m);
    m.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button'); if (!b) return;
      const d = b.dataset; m.hidden = true;
      if (d.add) addBlock(d.add);
      else if ('draw' in d) { const p = document.getElementById('customInsertPencil'); if (p) { p.dataset.pass = '1'; p.click(); delete p.dataset.pass; } }
      else if ('inlineExit' in d) customInlineExit();
    });
  }
  function buildPill() {
    if (document.getElementById('customSavePill')) return;
    const el = document.createElement('div');
    el.id = 'customSavePill'; el.className = 'cit-pill'; el.hidden = true;
    el.innerHTML = '<span>Modifications non enregistrées</span><button type="button">Enregistrer</button>';
    el.addEventListener('click', e => { e.stopPropagation(); if (e.target.closest('button')) customInlineSave(); });
    document.body.appendChild(el);
  }
  function buildToast(bar) {
    if (document.getElementById('customToast')) return;
    const t = document.createElement('div'); t.id = 'customToast'; t.className = 'cit-toast'; t.hidden = true;
    document.body.appendChild(t);
    const src = bar.querySelector('[data-inline-status]'); let timer;
    new MutationObserver(() => {
      const txt = src.textContent.trim();
      if (!txt || /^Modifications non enregistrées/.test(txt)) return;
      t.textContent = txt; t.hidden = false; clearTimeout(timer);
      timer = setTimeout(() => { t.hidden = true; }, /^Erreur|invalide/i.test(txt) ? 6000 : 2800);
    }).observe(src, { childList: true, characterData: true, subtree: true });
  }

  window.customInlineToolbar = function () {
    let bar = document.getElementById('customInlineToolbar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'customInlineToolbar'; bar.className = 'cit-bar'; bar.innerHTML = BAR; bar.hidden = true;
    document.body.appendChild(bar);
    buildMenu(); buildPill(); buildToast(bar);
    bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    bar.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = b.dataset;
      if (d.inlineCommand) { fmt(() => { ex('styleWithCSS', false); ex(d.inlineCommand); }); syncBar(); return; }
      if ('textLink' in d) {
        let u = (prompt('Adresse du lien (https://…, mailto:, tel:)') || '').trim(); if (!u) return;
        if (/^www\./i.test(u)) u = 'https://' + u;
        if (!/^(https?:\/\/|mailto:|tel:)/i.test(u)) { status('Lien invalide.'); return; }
        fmt(() => { if (getSelection().isCollapsed) ex('insertHTML', '<a href="' + escA(u) + '">' + escT(u) + '</a>'); else ex('createLink', u); });
        return;
      }
      if ('inlineDelete' in d) { customInlineDeleteSelected(); return; }
      if ('inlineSave' in d) customInlineSave();
    });
    bar.addEventListener('change', e => {
      const v = e.target.value;
      if (e.target.matches('[data-inline-font-size]')) applySize(v);
      else if (e.target.matches('[data-inline-font]')) fmt(() => { ex('styleWithCSS', true); ex('fontName', v); }, true);
      else if (e.target.matches('[data-inline-color]')) fmt(() => { ex('styleWithCSS', true); ex('foreColor', v); }, true);
      else if (e.target.matches('[data-inline-align]')) fmt(() => { ex('styleWithCSS', true); ex('justify' + v); }, true);
    });
    return bar;
  };

  window.customInlineUpdateSelectionUI = function () {
    document.querySelectorAll('.custom-site-block-canvas,[data-custom-block-id]').forEach(box => {
      const id = box.dataset.customCanvasId || box.dataset.customBlockId;
      box.classList.toggle('custom-block-selected', !!customInlineEditor.selectedId && id === customInlineEditor.selectedId);
    });
    const a = document.activeElement;
    if (!customInlineEditor.selectedId && a && a.closest && a.closest('[data-custom-text]')) a.blur();
    refreshUI();
  };
  const baseDirty = window.customInlineMarkDirty;
  window.customInlineMarkDirty = function () { const r = baseDirty.apply(this, arguments); refreshUI(); return r; };

  // Le « ＋ » en bas à gauche : entre en édition, puis ouvre / ferme le menu d'ajout.
  document.addEventListener('click', e => {
    const p = e.target.closest && e.target.closest('#customInsertPencil');
    if (!p || p.dataset.pass) return;
    const editing = document.body.classList.contains('custom-inline-editing');
    if (editing && customCanvasSelecting) return; // un clic de plus annule le dessin en cours
    e.stopImmediatePropagation(); e.preventDefault();
    if (!editing) openCustomBlocksManager();
    const m = document.getElementById('customAddMenu');
    if (m) m.hidden = editing ? !m.hidden : false;
  }, true);
  document.addEventListener('click', e => {
    const m = document.getElementById('customAddMenu');
    if (m && !m.hidden && !m.contains(e.target)) m.hidden = true;
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !document.body.classList.contains('custom-inline-editing') || customCanvasSelecting) return;
    const m = document.getElementById('customAddMenu'); if (m) m.hidden = true;
    customInlineEditor.selectedId = null; customInlineUpdateSelectionUI();
  });
  const baseExit = window.customInlineExit;
  window.customInlineExit = function () {
    const r = baseExit.apply(this, arguments);
    if (!document.body.classList.contains('custom-inline-editing')) ['customAddMenu', 'customSavePill', 'customToast'].forEach(id => document.getElementById(id)?.remove());
    return r;
  };

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
  function startResize(box, e) {
    e.preventDefault(); e.stopPropagation();
    const id = box.dataset.customCanvasId;
    const b = customInlineEditor.blocks.find(x => String(x.id) === String(id));
    if (!b) return;
    customInlineEditor.selectedId = id; customInlineUpdateSelectionUI();
    const anchor = box.parentElement;
    const ar = anchor.getBoundingClientRect(), br = box.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY, startW = br.width, startH = br.height;
    const minW = 90, minH = 60;
    const move = ev => {
      const width = Math.max(minW, startW + ev.clientX - startX);
      const height = Math.max(minH, startH + ev.clientY - startY);
      box.style.width = Math.min(anchor.clientWidth, width) + 'px';
      if (!b.image_url) box.style.height = height + 'px';
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      const width = Math.max(minW, box.getBoundingClientRect().width);
      const height = Math.max(minH, box.getBoundingClientRect().height);
      b.placement = { ...(b.placement || {}), mode: 'canvas',
        width: clamp(width / Math.max(1, anchor.clientWidth) * 100, 10, 100),
        height: clamp(height, 60, 1600) };
      customInlineMarkDirty(); customInlineRender();
      customInlineEditor.selectedId = id; customInlineUpdateSelectionUI();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
    document.addEventListener('pointercancel', up, { once: true });
  }
  function addHandles(box) {
    if (!box.querySelector('.custom-drag-handle')) {
      const drag = document.createElement('span'); drag.className = 'custom-drag-handle'; drag.contentEditable = 'false'; drag.title = 'Déplacer le bloc'; drag.textContent = '✥';
      drag.addEventListener('pointerdown', e => startDrag(box, e));
      drag.addEventListener('click', e => e.stopPropagation());
      box.appendChild(drag);
    }
    if (!box.querySelector('.custom-delete-handle')) {
      const del = document.createElement('span'); del.className = 'custom-delete-handle'; del.contentEditable = 'false'; del.title = 'Supprimer ce bloc'; del.textContent = '✕';
      del.addEventListener('pointerdown', e => e.stopPropagation());
      del.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); customInlineEditor.selectedId = box.dataset.customCanvasId; customInlineDeleteSelected(); });
      box.appendChild(del);
    }
    if (!box.querySelector('.custom-resize-handle')) {
      const resize = document.createElement('span'); resize.className = 'custom-resize-handle'; resize.contentEditable = 'false'; resize.title = 'Redimensionner le bloc'; resize.setAttribute('aria-label', 'Redimensionner le bloc'); resize.textContent = '↘';
      resize.addEventListener('pointerdown', e => startResize(box, e));
      resize.addEventListener('click', e => e.stopPropagation());
      box.appendChild(resize);
    }
    const ar = box.parentElement && box.parentElement.getBoundingClientRect();
    if (ar && box.getBoundingClientRect().top - ar.top < 30) box.classList.add('handles-in');
  }
  const baseAttach = window.customInlineAttachInteractions;
  window.customInlineAttachInteractions = function () {
    const r = baseAttach.apply(this, arguments);
    document.querySelectorAll('.custom-site-block-canvas').forEach(addHandles);
    return r;
  };

  const baseSave = window.customInlineSave;
  window.customInlineSave = async function () {
    // Une sauvegarde déclenchée par le clic extérieur peut se terminer après
    // qu'une autre case a déjà été sélectionnée. Ne jamais effacer cette
    // nouvelle sélection à la fin de la requête.
    const selectedAtStart = customInlineEditor.selectedId;
    const r = await baseSave.apply(this, arguments);
    // Le rendu de sauvegarde reconstruit les cases ; on restaure uniquement
    // la sélection réellement active, sans forcer une désélection.
    if (selectedAtStart != null && customInlineEditor.selectedId == null) {
      customInlineEditor.selectedId = selectedAtStart;
    }
    customInlineUpdateSelectionUI();
    return r;
  };

  const css = document.createElement('style');
  css.textContent = [
    '.custom-drag-handle,.custom-delete-handle,.custom-resize-handle{position:absolute;z-index:25;width:30px;height:28px;display:none;align-items:center;justify-content:center;font:700 15px Arial,sans-serif;touch-action:none;user-select:none}',
    '.custom-drag-handle,.custom-delete-handle{top:-30px}',
    '.custom-drag-handle{left:0;background:#d5a64c;color:#173f36;cursor:grab;border-radius:8px 0 0 8px}',
    '.custom-delete-handle{right:0;background:#b83a3a;color:#fff;cursor:pointer;border-radius:0 8px 8px 0}',
    '.custom-resize-handle{right:0;bottom:0;background:#2878b8;color:#fff;cursor:nwse-resize;border-radius:7px 0 0 0}',
    'body.custom-inline-editing .custom-site-block-canvas:hover>.custom-drag-handle,body.custom-inline-editing .custom-site-block-canvas:hover>.custom-delete-handle,body.custom-inline-editing .custom-site-block-canvas:hover>.custom-resize-handle,body.custom-inline-editing .custom-block-selected>.custom-drag-handle,body.custom-inline-editing .custom-block-selected>.custom-delete-handle,body.custom-inline-editing .custom-block-selected>.custom-resize-handle{display:flex}',
    '.custom-site-block-canvas.handles-in>.custom-drag-handle,.custom-site-block-canvas.handles-in>.custom-delete-handle{top:0}',
    '.custom-site-block-canvas.custom-image-only .custom-site-block-image{height:calc(100% - 40px)}',
    /* aucun cadre autour des blocs ; seul le survol / la sélection en montre un, comme les autres éléments modifiables */
    '#publicApp .custom-site-block.custom-site-block-canvas{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;overflow:visible!important;outline:none!important}',
    'body.private-preview-editing #publicApp .custom-site-block-canvas:hover,body.private-preview-editing #publicApp [data-custom-block-id]:hover,body.custom-inline-editing #publicApp .custom-site-block-canvas:hover,body.custom-inline-editing #publicApp [data-custom-block-id]:hover{outline:2px dashed #c49b55!important;outline-offset:5px!important;border-radius:5px}',
    'body.custom-inline-editing #publicApp .custom-site-block-canvas.custom-block-selected,body.custom-inline-editing #publicApp [data-custom-block-id].custom-block-selected{outline:3px solid #2878b8!important;outline-offset:6px!important;border-radius:5px;background:transparent!important}',
    'body:not(.custom-inline-editing) .custom-block-editable-text:before{content:none!important}',
    /* barre flottante */
    '.cit-bar{position:fixed;top:0!important;z-index:30000;display:flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:calc(100vw - 16px);padding:8px 10px;background:#fff;color:#173f36;border:1px solid #dbe4dc;border-radius:12px;box-shadow:0 10px 30px #173f3633;font:13px Arial,sans-serif}',
    '.cit-bar[hidden],.cit-menu[hidden],.cit-pill[hidden],.cit-toast[hidden]{display:none!important}',
    '.cit-bar button,.cit-bar select,.cit-bar label{font:inherit;color:#173f36}',
    '.cit-bar button{min-width:34px;height:34px;padding:0 10px;border:1px solid #dbe4dc;border-radius:8px;background:#f4f7f3;cursor:pointer}',
    '.cit-bar button:hover{background:#e6efe6}.cit-bar button.on{background:#ecd9a8;border-color:#c49b55}',
    '.cit-bar button.save{background:#1e5a49;border-color:#1e5a49;color:#fff;font-weight:700}.cit-bar button.danger{color:#a33}',
    '.cit-bar select{height:34px;border:1px solid #dbe4dc;border-radius:8px;background:#fff;padding:0 6px;cursor:pointer}',
    '.cit-bar .cit-color{display:flex;align-items:center;gap:6px;height:34px;padding:0 8px;border:1px solid #dbe4dc;border-radius:8px;background:#f4f7f3;cursor:pointer}',
    '.cit-bar .cit-color input{width:24px;height:24px;padding:0;border:0;background:none;cursor:pointer}',
    '.cit-bar .cit-sep{flex:1;min-width:4px}',
    /* menu « ＋ » */
    '.cit-menu{position:fixed;left:18px;bottom:82px;z-index:30000;display:flex;flex-direction:column;gap:2px;min-width:250px;padding:10px;background:#fff;border:1px solid #dbe4dc;border-radius:14px;box-shadow:0 12px 34px #173f3633;font:14px Arial,sans-serif}',
    '.cit-menu p{margin:2px 8px 6px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#6b8076}',
    '.cit-menu button{display:flex;align-items:center;gap:10px;padding:10px 12px;border:0;border-radius:8px;background:transparent;color:#173f36;font:inherit;text-align:left;cursor:pointer}',
    '.cit-menu button b{width:20px;text-align:center}.cit-menu button:hover{background:#eef4ee}.cit-menu hr{border:0;border-top:1px solid #e5ece5;margin:4px 0}',
    /* pastille d'enregistrement + message */
    '.cit-pill{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:30000;display:flex;align-items:center;gap:12px;padding:8px 10px 8px 16px;background:#173f36;color:#fff;border-radius:999px;box-shadow:0 8px 26px #0004;font:13px Arial,sans-serif;white-space:nowrap}',
    '.cit-pill button{height:32px;padding:0 14px;border:0;border-radius:999px;background:#d7b36d;color:#173f36;font:700 13px Arial,sans-serif;cursor:pointer}',
    '.cit-toast{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:30001;max-width:calc(100vw - 24px);padding:9px 16px;background:#173f36;color:#fff;border-radius:999px;font:13px Arial,sans-serif;box-shadow:0 8px 24px #0004}'
  ].join('\n');
  document.head.appendChild(css);
})();