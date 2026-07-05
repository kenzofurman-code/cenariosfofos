import { STICKERS } from './assets/manifest.js';
import {
  saveScenarioLocal, loadScenariosLocal,
  saveLayoutLocal, loadLayoutLocal,
  deleteScenarioLocal, deleteLayoutLocal
} from './db-local.js';
import {
  cloudEnabled, initCloud,
  saveScenarioCloud, loadScenariosCloud,
  saveLayoutCloud, loadLayoutCloud,
  deleteScenarioCloud, getSyncFolderId
} from './firebase.js';

// ======================= DOM refs =======================
const stage = document.getElementById('stage');
const stageInner = document.getElementById('stageInner');
const stageBg = document.getElementById('stageBg');
const paletteGrid = document.getElementById('paletteGrid');
const dragGhost = document.getElementById('dragGhost');
const itemToolbar = document.getElementById('itemToolbar');
const refCard = document.getElementById('refCard');
const refThumb = document.getElementById('refThumb');
const refSizeSlider = document.getElementById('refSizeSlider');
const workCanvas = document.getElementById('workCanvas');
const syncStatusEl = document.getElementById('syncStatus');

// ======================= Small utils =======================
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function dist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }

function loadImageFromSrc(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function loadImageFromFile(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
async function fileToDataURLResized(file, maxDim){
  const img = await loadImageFromFile(file);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/webp', 0.85);
}

// ======================= In-browser sticker segmentation =======================
function boxMax1D(src, w, h, r, horizontal){
  const out = new Uint8Array(w*h);
  if (horizontal){
    for (let y=0; y<h; y++){
      const off = y*w;
      for (let x=0; x<w; x++){
        let m = 0;
        const xs = Math.max(0, x-r), xe = Math.min(w-1, x+r);
        for (let xx=xs; xx<=xe; xx++){ if (src[off+xx]){ m=1; break; } }
        out[off+x] = m;
      }
    }
  } else {
    for (let x=0; x<w; x++){
      for (let y=0; y<h; y++){
        let m = 0;
        const ys = Math.max(0, y-r), ye = Math.min(h-1, y+r);
        for (let yy=ys; yy<=ye; yy++){ if (src[yy*w+x]){ m=1; break; } }
        out[y*w+x] = m;
      }
    }
  }
  return out;
}
function boxMin1D(src, w, h, r, horizontal){
  const out = new Uint8Array(w*h);
  if (horizontal){
    for (let y=0; y<h; y++){
      const off = y*w;
      for (let x=0; x<w; x++){
        let m = 1;
        const xs = Math.max(0, x-r), xe = Math.min(w-1, x+r);
        for (let xx=xs; xx<=xe; xx++){ if (!src[off+xx]){ m=0; break; } }
        out[off+x] = m;
      }
    }
  } else {
    for (let x=0; x<w; x++){
      for (let y=0; y<h; y++){
        let m = 1;
        const ys = Math.max(0, y-r), ye = Math.min(h-1, y+r);
        for (let yy=ys; yy<=ye; yy++){ if (!src[yy*w+x]){ m=0; break; } }
        out[y*w+x] = m;
      }
    }
  }
  return out;
}
function closeMask(mask, w, h, r){
  let d = boxMax1D(mask, w, h, r, true);
  d = boxMax1D(d, w, h, r, false);
  let e = boxMin1D(d, w, h, r, true);
  e = boxMin1D(e, w, h, r, false);
  return e;
}

async function segmentStickerSheet(file, maxDim = 1400, minAreaPx = 500){
  const img = await loadImageFromFile(file);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  workCanvas.width = w; workCanvas.height = h;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const n = w * h;

  // 1) Amostra a cor de fundo nos 4 cantos da folha para detectar a cor do papel
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1]
  ];
  let sumR = 0, sumG = 0, sumB = 0;
  corners.forEach(([cx, cy]) => {
    const o = (cy * w + cx) * 4;
    sumR += data[o];
    sumG += data[o + 1];
    sumB += data[o + 2];
  });
  const bgR = sumR / 4;
  const bgG = sumG / 4;
  const bgB = sumB / 4;

  // 2) Classifica os pixels como fundo se a distância de cor R-G-B for menor que a tolerância
  const isBgCandidate = new Uint8Array(n);
  const tolerance = 30; // distância euclidiana R-G-B tolerável
  for (let i = 0; i < n; i++){
    const o = i*4;
    const dr = data[o] - bgR;
    const dg = data[o+1] - bgG;
    const db = data[o+2] - bgB;
    const dist = Math.sqrt(dr*dr + dg*dg + db*db);
    isBgCandidate[i] = (dist < tolerance) ? 1 : 0;
  }

  let bgMask = boxMin1D(isBgCandidate, w, h, 1, true);
  bgMask = boxMin1D(bgMask, w, h, 1, false);

  const background = new Uint8Array(n);
  const stack = [];
  function seed(x, y){
    const i = y*w + x;
    if (bgMask[i] && !background[i]){ background[i] = 1; stack.push(i); }
  }
  for (let x = 0; x < w; x++){ seed(x, 0); seed(x, h-1); }
  for (let y = 0; y < h; y++){ seed(0, y); seed(w-1, y); }
  while (stack.length){
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0){ const j=i-1; if (bgMask[j] && !background[j]){ background[j]=1; stack.push(j); } }
    if (x < w-1){ const j=i+1; if (bgMask[j] && !background[j]){ background[j]=1; stack.push(j); } }
    if (y > 0){ const j=i-w; if (bgMask[j] && !background[j]){ background[j]=1; stack.push(j); } }
    if (y < h-1){ const j=i+w; if (bgMask[j] && !background[j]){ background[j]=1; stack.push(j); } }
  }

  const foreground = new Uint8Array(n);
  for (let i = 0; i < n; i++) foreground[i] = background[i] ? 0 : 1;
  const closed = closeMask(foreground, w, h, 1);

  const labels = new Int32Array(n).fill(-1);
  const comps = [];
  const stack2 = [];
  let labelId = 0;
  for (let start = 0; start < n; start++){
    if (closed[start] !== 1 || labels[start] !== -1) continue;
    labels[start] = labelId;
    stack2.push(start);
    let minX = w, minY = h, maxX = 0, maxY = 0, count = 0;
    while (stack2.length){
      const i = stack2.pop();
      const x = i % w, y = (i / w) | 0;
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++){
        for (let dx = -1; dx <= 1; dx++){
          if (dx === 0 && dy === 0) continue;
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const j = ny*w + nx;
          if (closed[j] === 1 && labels[j] === -1){ labels[j] = labelId; stack2.push(j); }
        }
      }
    }
    comps.push({ minX, minY, maxX, maxY, count, labelId });
    labelId++;
  }

  const results = [];
  const pad = 3;
  for (const c of comps){
    if (c.count < minAreaPx) continue;
    const cw = c.maxX - c.minX + 1, ch = c.maxY - c.minY + 1;
    if (cw < 12 || ch < 12) continue;
    const x0 = Math.max(0, c.minX - pad), y0 = Math.max(0, c.minY - pad);
    const x1 = Math.min(w, c.maxX + pad + 1), y1 = Math.min(h, c.maxY + pad + 1);
    const outW = x1 - x0, outH = y1 - y0;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW; outCanvas.height = outH;
    const octx = outCanvas.getContext('2d');
    const outData = octx.createImageData(outW, outH);
    for (let yy = 0; yy < outH; yy++){
      for (let xx = 0; xx < outW; xx++){
        const srcX = x0+xx, srcY = y0+yy;
        const srcI = srcY*w + srcX;
        const srcO = srcI*4;
        const dstO = (yy*outW+xx)*4;
        outData.data[dstO]   = data[srcO];
        outData.data[dstO+1] = data[srcO+1];
        outData.data[dstO+2] = data[srcO+2];
        outData.data[dstO+3] = (labels[srcI] === c.labelId) ? 255 : 0;
      }
    }
    octx.putImageData(outData, 0, 0);
    results.push({ uri: outCanvas.toDataURL('image/png'), w: outW, h: outH });
  }
  return results;
}

// ======================= Scenario management =======================
const scenarios = [];
let currentScenarioIndex = 0;

function getCurrentScenario(){ return scenarios[currentScenarioIndex]; }

function buildDefaultScenario(){
  const order = { moveis: 0, bichinhos: 1, docinhos: 2 };
  const stickers = STICKERS
    .slice()
    .sort((a,b) => (order[a.cat] ?? 9) - (order[b.cat] ?? 9))
    .map(s => ({ uri: 'assets/stickers/' + s.file, w: s.w, h: s.h }));
  return {
    id: 'loja',
    name: '🏬 Loja',
    background: 'assets/background_empty.webp',
    thumbnail: 'assets/thumbnail_complete.webp',
    stickers,
    variantCache: {}
  };
}

function renderScenarioSwitcher(){
  const el = document.getElementById('scenarioSwitcher');
  el.innerHTML = '';
  scenarios.forEach((sc, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'scenario-card-wrapper';

    const btn = document.createElement('button');
    btn.className = 'scenario-btn' + (idx === currentScenarioIndex ? ' active' : '');
    btn.textContent = sc.name;
    btn.addEventListener('click', () => selectScenario(idx));
    wrapper.appendChild(btn);

    const delBtn = document.createElement('button');
    delBtn.className = 'scenario-delete-btn';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Excluir cenário';
    delBtn.addEventListener('click', (e) => deleteScenario(idx, e));
    wrapper.appendChild(delBtn);

    el.appendChild(wrapper);
  });
}

async function deleteScenario(idx, event) {
  event.stopPropagation();
  const sc = scenarios[idx];
  if (!sc) return;

  const confirmDelete = confirm(`Deseja mesmo excluir o cenário "${sc.name}"?`);
  if (!confirmDelete) return;

  // Se o cenário deletado for o ativo
  if (idx === currentScenarioIndex) {
    if (scenarios.length > 1) {
      const nextIdx = (idx === 0) ? 1 : idx - 1;
      await selectScenario(nextIdx);
    } else {
      await selectScenario(-1);
    }
  }

  // Remove do array local
  scenarios.splice(idx, 1);

  // Ajusta o índice do cenário ativo
  if (scenarios.length === 0) {
    currentScenarioIndex = -1;
  } else if (currentScenarioIndex > idx) {
    currentScenarioIndex--;
  }

  // Deleta do IndexedDB local
  try {
    await deleteScenarioLocal(sc.id);
    await deleteLayoutLocal(sc.id);
  } catch (e) {
    console.warn('Erro ao deletar cenário do cache local', e);
  }

  // Deleta do Firebase
  if (cloudEnabled) {
    try {
      await deleteScenarioCloud(sc.id);
    } catch (e) {
      console.warn('Erro ao deletar cenário da nuvem', e);
    }
  }

  // Re-renderiza a lista de cenários
  renderScenarioSwitcher();
}


// ---- per-scenario layout persistence ----
async function saveCurrentLayout(){
  const sc = scenarios[currentScenarioIndex];
  if (!sc) return;
  const snap = snapshot();
  await saveLayoutLocal(sc.id, snap);
  if (cloudEnabled) saveLayoutCloud(sc.id, snap); // fire and forget
}

async function selectScenario(idx, isInitialLoad = false){
  if (!isInitialLoad) await saveCurrentLayout(); // don't lose in-progress work on the scenario we're leaving

  if (scenarios.length === 0 || idx === -1) {
    currentScenarioIndex = -1;
    stageBg.src = 'assets/background_empty.webp';
    refCard.style.display = 'none';

    renderPalette();
    renderScenarioSwitcher();
    resetView();

    placedItems.forEach(r => r.el.remove());
    placedItems = [];
    deselect();
    history = [];
    return;
  }

  currentScenarioIndex = idx;
  const sc = getCurrentScenario();
  if (!sc) return;

  if (sc.thumbnail){ refThumb.src = sc.thumbnail; refCard.style.display = ''; }
  else { refCard.style.display = 'none'; }

  stageBg.src = sc.background;
  renderPalette();
  renderScenarioSwitcher();
  resetView();

  // clear canvas then restore this scenario's own saved layout (if any)
  placedItems.forEach(r => r.el.remove());
  placedItems = [];
  deselect();
  history = [];
  const savedLayout = await loadLayoutLocal(sc.id);
  if (savedLayout && savedLayout.length){
    savedLayout.forEach(s => placeStickerSilently(s.uri, s.xPct, s.yPct, s.width, s.z));
  }
  pushHistory(false); // seed baseline without re-triggering a save loop

  // Buscar layout atualizado na nuvem em segundo plano
  if (cloudEnabled) {
    (async () => {
      try {
        const cloudLayout = await loadLayoutCloud(sc.id);
        if (cloudLayout) {
          const localJSON = JSON.stringify(savedLayout || []);
          const cloudJSON = JSON.stringify(cloudLayout);
          if (localJSON !== cloudJSON) {
            await saveLayoutLocal(sc.id, cloudLayout);
            // Se o usuário ainda estiver no mesmo cenário, atualiza a tela
            if (currentScenarioIndex === idx) {
              placedItems.forEach(r => r.el.remove());
              placedItems = [];
              deselect();
              history = [];
              cloudLayout.forEach(s => placeStickerSilently(s.uri, s.xPct, s.yPct, s.width, s.z));
              pushHistory(false);
            }
          }
        }
      } catch (e) {
        console.warn('Erro ao sincronizar layout da nuvem', e);
      }
    })();
  }
}

// ======================= Palette (single unified grid) =======================
function renderPalette(){
  paletteGrid.innerHTML = '';
  const sc = getCurrentScenario();
  if (!sc) {
    paletteGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--ink); opacity: 0.6; padding: 20px; font-family: \'Baloo 2\', cursive; font-weight: 700;">Nenhum cenário selecionado. Importe um cenário para começar! 🧺</div>';
    return;
  }
  sc.stickers.forEach(s => {
    const cell = document.createElement('div');
    cell.className = 'palette-item';
    const img = document.createElement('img');
    img.src = s.uri;
    img.draggable = false;
    cell.appendChild(img);
    cell.addEventListener('pointerdown', (e) => startDragFromPalette(e, s));
    paletteGrid.appendChild(cell);
  });
}

// ======================= Dragging a NEW sticker from the palette =======================
let dragState = null;
function startDragFromPalette(e, stickerData){
  e.preventDefault();
  dragState = { sticker: stickerData };
  dragGhost.src = stickerData.uri;
  dragGhost.style.width = '90px';
  dragGhost.classList.remove('hidden');
  moveGhost(e.clientX, e.clientY);
  window.addEventListener('pointermove', onPaletteDragMove);
  window.addEventListener('pointerup', onPaletteDragEnd, { once: true });
}
function moveGhost(x, y){ dragGhost.style.left = x + 'px'; dragGhost.style.top = y + 'px'; }
function onPaletteDragMove(e){ moveGhost(e.clientX, e.clientY); }
function onPaletteDragEnd(e){
  window.removeEventListener('pointermove', onPaletteDragMove);
  dragGhost.classList.add('hidden');
  const stageRect = stage.getBoundingClientRect();
  if (e.clientX >= stageRect.left && e.clientX <= stageRect.right &&
      e.clientY >= stageRect.top && e.clientY <= stageRect.bottom){
    const innerRect = stageInner.getBoundingClientRect();
    const relX = ((e.clientX - innerRect.left) / innerRect.width) * 100;
    const relY = ((e.clientY - innerRect.top) / innerRect.height) * 100;
    placeSticker(dragState.sticker, relX, relY);
  }
  dragState = null;
}

// ======================= Placing & manipulating stickers on stage =======================
let placedItems = [];
let idCounter = 1;
let zCounter = 1;
let selectedItem = null;
let history = [];
let saveTimer = null;

function scheduleLayoutSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentLayout, 900);
}

function placeSticker(stickerData, xPct, yPct, opts = {}){
  const id = 'item' + (idCounter++);
  const el = document.createElement('img');
  el.src = stickerData.uri;
  el.className = 'placed';
  el.draggable = false;
  el.dataset.id = id;
  const baseWidth = opts.widthPx || Math.min(140, (stickerData.w || 300) * 0.32);
  el.style.width = baseWidth + 'px';
  el.style.left = xPct + '%';
  el.style.top = yPct + '%';
  el.style.transform = 'translate(-50%,-50%)';
  zCounter++;
  el.style.zIndex = opts.z || zCounter;
  stageInner.appendChild(el);
  const record = { id, el, uri: stickerData.uri, xPct, yPct, width: baseWidth, z: el.style.zIndex };
  placedItems.push(record);
  el.addEventListener('pointerdown', (e) => startMovePlaced(e, record));
  selectItem(record);
  pushHistory();
  return record;
}
function placeStickerSilently(uri, xPct, yPct, widthPx, z){
  const id = 'item' + (idCounter++);
  const el = document.createElement('img');
  el.src = uri;
  el.className = 'placed';
  el.draggable = false;
  el.dataset.id = id;
  el.style.width = widthPx + 'px';
  el.style.left = xPct + '%';
  el.style.top = yPct + '%';
  el.style.transform = 'translate(-50%,-50%)';
  el.style.zIndex = z;
  stageInner.appendChild(el);
  const record = { id, el, uri, xPct, yPct, width: widthPx, z };
  placedItems.push(record);
  el.addEventListener('pointerdown', (e) => startMovePlaced(e, record));
  return record;
}
function startMovePlaced(e, record){
  e.stopPropagation();
  e.preventDefault();
  selectItem(record);
  let moved = false;
  function onMove(ev){
    moved = true;
    const innerRect = stageInner.getBoundingClientRect();
    const relX = ((ev.clientX - innerRect.left) / innerRect.width) * 100;
    const relY = ((ev.clientY - innerRect.top) / innerRect.height) * 100;
    const cx = clamp(relX, 0, 100), cy = clamp(relY, 0, 100);
    record.xPct = cx; record.yPct = cy;
    record.el.style.left = cx + '%';
    record.el.style.top = cy + '%';
    positionToolbar(record);
  }
  function onUp(){
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) pushHistory();
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

// ======================= Selection + floating toolbar =======================
function selectItem(record){
  if (selectedItem) selectedItem.el.classList.remove('selected');
  selectedItem = record;
  record.el.classList.add('selected');
  record.el.style.zIndex = ++zCounter;
  itemToolbar.classList.remove('hidden');
  positionToolbar(record);
}
function deselect(){
  if (selectedItem) selectedItem.el.classList.remove('selected');
  selectedItem = null;
  itemToolbar.classList.add('hidden');
}
function positionToolbar(record){
  const rect = record.el.getBoundingClientRect();
  itemToolbar.style.left = (rect.left + rect.width / 2) + 'px';
  itemToolbar.style.top = (rect.top - 46) + 'px';
  itemToolbar.style.transform = 'translateX(-50%)';
}
itemToolbar.addEventListener('pointerdown', (e) => e.stopPropagation());
itemToolbar.addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (!action || !selectedItem) return;
  const rec = selectedItem;
  if (action === 'delete'){
    rec.el.remove();
    placedItems = placedItems.filter(r => r.id !== rec.id);
    deselect();
  } else if (action === 'bigger'){
    rec.width = Math.min(360, rec.width * 1.15);
    rec.el.style.width = rec.width + 'px';
    positionToolbar(rec);
  } else if (action === 'smaller'){
    rec.width = Math.max(40, rec.width * 0.87);
    rec.el.style.width = rec.width + 'px';
    positionToolbar(rec);
  } else if (action === 'front'){
    rec.el.style.zIndex = ++zCounter;
  }
  pushHistory();
});
window.addEventListener('resize', () => { if (selectedItem) positionToolbar(selectedItem); });

// ======================= Pan & Zoom =======================
let panX = 0, panY = 0, zoom = 1;
const activePointers = new Map();
let isPanning = false;
let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
let pinchStartDist = 0, pinchStartZoom = 1, pinchMid = { x: 0, y: 0 }, pinchStartPan = { x: 0, y: 0 };

function applyTransform(){
  stageInner.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  if (selectedItem) positionToolbar(selectedItem);
}
function resetView(){ zoom = 1; panX = 0; panY = 0; applyTransform(); }

stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.placed')) return;
  deselect();
  stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 1){
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY, panX, panY };
  } else if (activePointers.size === 2){
    isPanning = false;
    beginPinch();
  }
});
window.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 2){ updatePinch(); return; }
  if (isPanning && activePointers.size === 1){
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    panX = panStart.panX + dx;
    panY = panStart.panY + dy;
    applyTransform();
  }
});
function endPointer(e){
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) pinchStartDist = 0;
  if (activePointers.size === 0) isPanning = false;
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
function getPinchPoints(){ return Array.from(activePointers.values()); }
function beginPinch(){
  const pts = getPinchPoints();
  if (pts.length < 2) return;
  pinchStartDist = dist(pts[0], pts[1]);
  pinchStartZoom = zoom;
  pinchMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  pinchStartPan = { x: panX, y: panY };
}
function updatePinch(){
  const pts = getPinchPoints();
  if (pts.length < 2 || pinchStartDist === 0) return;
  const d = dist(pts[0], pts[1]);
  const ratio = d / pinchStartDist;
  const newZoom = clamp(pinchStartZoom * ratio, 0.4, 4);
  const stageRect = stage.getBoundingClientRect();
  const localX = pinchMid.x - stageRect.left;
  const localY = pinchMid.y - stageRect.top;
  const contentX = (localX - pinchStartPan.x) / pinchStartZoom;
  const contentY = (localY - pinchStartPan.y) / pinchStartZoom;
  panX = localX - contentX * newZoom;
  panY = localY - contentY * newZoom;
  zoom = newZoom;
  applyTransform();
}
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const stageRect = stage.getBoundingClientRect();
  const localX = e.clientX - stageRect.left;
  const localY = e.clientY - stageRect.top;
  const delta = -e.deltaY * 0.0015;
  const newZoom = clamp(zoom * (1 + delta), 0.4, 4);
  const contentX = (localX - panX) / zoom;
  const contentY = (localY - panY) / zoom;
  panX = localX - contentX * newZoom;
  panY = localY - contentY * newZoom;
  zoom = newZoom;
  applyTransform();
}, { passive: false });
function zoomButtonStep(factor){
  const stageRect = stage.getBoundingClientRect();
  const localX = stageRect.width / 2, localY = stageRect.height / 2;
  const newZoom = clamp(zoom * factor, 0.4, 4);
  const contentX = (localX - panX) / zoom;
  const contentY = (localY - panY) / zoom;
  panX = localX - contentX * newZoom;
  panY = localY - contentY * newZoom;
  zoom = newZoom;
  applyTransform();
}
document.getElementById('zoomIn').addEventListener('click', () => zoomButtonStep(1.25));
document.getElementById('zoomOut').addEventListener('click', () => zoomButtonStep(1/1.25));
document.getElementById('zoomReset').addEventListener('click', resetView);

// ======================= Undo / Reset =======================
function snapshot(){
  return placedItems.map(r => ({ uri: r.uri, xPct: r.xPct, yPct: r.yPct, width: r.width, z: r.z }));
}
function pushHistory(save = true){
  history.push(snapshot());
  if (history.length > 60) history.shift();
  if (save) scheduleLayoutSave();
}
function restoreFromSnapshotNoHistory(snap){
  placedItems.forEach(r => r.el.remove());
  placedItems = [];
  deselect();
  snap.forEach(s => placeStickerSilently(s.uri, s.xPct, s.yPct, s.width, s.z));
}
document.getElementById('btnReset').addEventListener('click', () => {
  if (placedItems.length === 0) return;
  if (confirm('Tem certeza que quer limpar tudo e recomeçar?')){
    placedItems.forEach(r => r.el.remove());
    placedItems = [];
    deselect();
    pushHistory();
  }
});
document.getElementById('btnUndo').addEventListener('click', () => {
  if (history.length <= 1){
    if (history.length === 1 && placedItems.length > 0){
      placedItems.forEach(r => r.el.remove());
      placedItems = [];
      deselect();
      history = [];
      scheduleLayoutSave();
    }
    return;
  }
  history.pop();
  const prev = history[history.length - 1];
  restoreFromSnapshotNoHistory(prev);
  scheduleLayoutSave();
});

// ======================= Reference thumbnail size slider =======================
refSizeSlider.addEventListener('input', () => { refCard.style.width = refSizeSlider.value + 'px'; });
refCard.style.width = refSizeSlider.value + 'px';

// ======================= Import scenario modal =======================
const importModal = document.getElementById('importModal');
document.getElementById('btnImport').addEventListener('click', () => importModal.classList.remove('hidden'));
document.getElementById('impCancel').addEventListener('click', () => importModal.classList.add('hidden'));
document.getElementById('impCreate').addEventListener('click', onCreateScenario);

// ======================= Family Code modal =======================
const familyModal = document.getElementById('familyModal');
const familyCodeInput = document.getElementById('familyCodeInput');
const btnSync = document.getElementById('btnSync');

btnSync.addEventListener('click', () => {
  familyCodeInput.value = localStorage.getItem('familyCode') || '';
  familyModal.classList.remove('hidden');
});

document.getElementById('familyCancel').addEventListener('click', () => {
  familyModal.classList.add('hidden');
});

document.getElementById('familySave').addEventListener('click', async () => {
  const code = familyCodeInput.value.trim();
  const oldCode = localStorage.getItem('familyCode') || '';
  
  if (code === oldCode) {
    familyModal.classList.add('hidden');
    return;
  }
  
  const saveBtn = document.getElementById('familySave');
  const cancelBtn = document.getElementById('familyCancel');
  
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  
  if (code) {
    localStorage.setItem('familyCode', code);
  } else {
    localStorage.removeItem('familyCode');
  }

  if (cloudEnabled && code) {
    const hintText = document.querySelector('#familyModal .modal-hint');
    try {
      hintText.textContent = 'Enviando cenários locais para a nova pasta da nuvem...';
      for (const sc of scenarios) {
        if (sc.id.startsWith('custom')) {
          await saveScenarioCloud(sc);
          const layout = await loadLayoutLocal(sc.id);
          if (layout && layout.length) {
            await saveLayoutCloud(sc.id, layout);
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao pré-sincronizar cenários locais', e);
    }
  }
  
  window.location.reload();
});

async function onCreateScenario(){
  const statusEl = document.getElementById('impStatus');
  const nameInput = document.getElementById('impName');
  const thumbInput = document.getElementById('impThumb');
  const bgInput = document.getElementById('impBg');
  const stickersInput = document.getElementById('impStickers');
  const createBtn = document.getElementById('impCreate');

  if (!bgInput.files[0]){ statusEl.textContent = 'Escolha ao menos a foto da cena vazia.'; return; }
  if (!stickersInput.files.length){ statusEl.textContent = 'Escolha ao menos uma foto de folha de adesivos.'; return; }

  createBtn.disabled = true;
  try {
    statusEl.textContent = 'Processando cena vazia...';
    await sleep(20);
    const bgURI = await fileToDataURLResized(bgInput.files[0], 1400);

    let thumbURI = '';
    if (thumbInput.files[0]){
      statusEl.textContent = 'Processando miniatura...';
      await sleep(20);
      thumbURI = await fileToDataURLResized(thumbInput.files[0], 700);
    }

    let allStickers = [];
    for (let i = 0; i < stickersInput.files.length; i++){
      statusEl.textContent = `Recortando adesivos (folha ${i+1} de ${stickersInput.files.length})...`;
      await sleep(20);
      const found = await segmentStickerSheet(stickersInput.files[i]);
      allStickers = allStickers.concat(found);
    }

    if (allStickers.length === 0){
      statusEl.textContent = 'Não encontrei adesivos nessa imagem. Tente uma foto com fundo bem claro.';
      createBtn.disabled = false;
      return;
    }

    const name = (nameInput.value || ('Cenário ' + (scenarios.length + 1))).trim();
    const newScenario = {
      id: 'custom' + Date.now(),
      name: '🧩 ' + name,
      background: bgURI,
      thumbnail: thumbURI,
      stickers: allStickers,
      variantCache: {}
    };

    statusEl.textContent = 'Salvando no cache do navegador...';
    await saveScenarioLocal(newScenario);
    scenarios.push(newScenario);

    statusEl.textContent = `Pronto! ${allStickers.length} peças encontradas.`;
    await sleep(500);
    importModal.classList.add('hidden');
    createBtn.disabled = false;
    nameInput.value = ''; thumbInput.value = ''; bgInput.value = ''; stickersInput.value = '';
    statusEl.textContent = '';

    await selectScenario(scenarios.length - 1);

    // sync to cloud in the background, if configured
    if (cloudEnabled){
      setSyncStatus('☁️ Enviando para a nuvem...');
      const ok = await saveScenarioCloud(newScenario);
      setSyncStatus(ok ? '☁️ Sincronizado' : '⚠️ Nuvem indisponível (salvo local)');
    }
  } catch (err){
    console.error(err);
    statusEl.textContent = 'Ops, deu um erro: ' + err.message;
    createBtn.disabled = false;
  }
}

// ======================= Sync status indicator =======================
function setSyncStatus(text){
  if (syncStatusEl) {
    const code = localStorage.getItem('familyCode');
    const suffix = (code && code.trim()) ? ` (Código: ${code.trim()})` : '';
    syncStatusEl.textContent = text + suffix;
  }
}

// ======================= Init =======================
(async function init(){
  // 1) instant local cache — works fully offline
  try {
    const localExtras = await loadScenariosLocal();
    localExtras.forEach(sc => {
      if (!scenarios.find(s => s.id === sc.id)) scenarios.push({ ...sc, variantCache: {} });
    });
  } catch (e){ console.warn('Cache local indisponível', e); }

  if (scenarios.length > 0) {
    await selectScenario(0, true);
  } else {
    await selectScenario(-1, true);
  }
  setSyncStatus(cloudEnabled ? '☁️ Conectando...' : '💾 Só local (sem Firebase configurado)');

  // 2) cloud sync in the background — never blocks first paint
  if (cloudEnabled){
    const ok = await initCloud();
    if (ok){
      setSyncStatus('☁️ Sincronizando...');
      try {
        const cloudScenarios = await loadScenariosCloud();
        let added = 0;
        const wasEmpty = (scenarios.length === 0);
        cloudScenarios.forEach(sc => {
          if (!scenarios.find(s => s.id === sc.id)){
            scenarios.push(sc);
            saveScenarioLocal(sc);
            added++;
          }
        });
        if (added) {
          renderScenarioSwitcher();
          if (wasEmpty && scenarios.length > 0) {
            await selectScenario(0, true);
          }
        }
        setSyncStatus('☁️ Sincronizado');
      } catch (e){
        console.warn(e);
        setSyncStatus('⚠️ Nuvem indisponível (usando cache local)');
      }
    } else {
      setSyncStatus('⚠️ Nuvem não conectou (usando cache local)');
    }
  }
})();
