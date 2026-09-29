'use strict';

/* =====================================================================
   CONFIGURAZIONE
   Metodi di pagamento proposti al primo avvio. Poi ognuno li cambia
   dall'app (Menu → Metodi di pagamento) e restano salvati sul suo telefono.
   - colore: colore del pulsante
   - bordo:  bordino e pallini (versione più luminosa, leggibile sul nero)
   I pagamenti già registrati conservano il nome del metodo, quindi
   togliere un metodo non cancella lo storico.
   ===================================================================== */
const METODI_INIZIALI = [
  { nome: 'Liquidi', colore: '#1c9614', bordo: '#3ccf33' },
  { nome: 'Freenow', colore: '#c20606', bordo: '#ff4a3d' },
  { nome: 'Carta',   colore: '#d9d2d2', bordo: '#f2eded' },
  { nome: 'Wetaxi',  colore: '#e0cb0b', bordo: '#ffe84a' },
  { nome: 'Globix',  colore: '#db7807', bordo: '#ff9d33' },
  { nome: 'Stid',    colore: '#8f0646', bordo: '#e0418a' },
  { nome: 'Apptaxi', colore: '#2b107d', bordo: '#7b5cff' },
];
const ORA_CAMBIO_GIORNO = 4;      // la giornata lavorativa cambia alle 4:00
const MINUTI_PRIMA_CORSA = 20;    // inizio turno stimato = primo incasso - 20 min
const STORAGE_KEY = 'appconti:v1';
const MAX_CENTS = 9999999;        // 99.999,99 €
const ROW_H = 38;                 // altezza riga della rotella
const DURATA_ANNULLA_MS = 4000;  // per quanto resta il popup "Annulla" dopo un inserimento

/* ===================== Dati ===================== */
const emptyDb = () => ({ v: 1, payments: [], fuel: {}, shifts: {}, lastBackup: null, methods: null, oldMethods: {} });
function load() {
  let d = null;
  try {
    const x = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (x && Array.isArray(x.payments)) d = { ...emptyDb(), ...x };
  } catch (e) { /* dati assenti o illeggibili */ }
  d = d || emptyDb();
  if (!Array.isArray(d.methods) || !d.methods.length) d.methods = METODI_INIZIALI.map(m => ({ ...m }));
  if (!d.oldMethods || typeof d.oldMethods !== 'object') d.oldMethods = {};
  if (!d.shifts || typeof d.shifts !== 'object') d.shifts = {};
  return d;
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  catch (e) { notify('Impossibile salvare i dati sul dispositivo.'); }
}
let db = load();

/* ===================== Utilità date ===================== */
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function parseYmd(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = parseYmd(k); d.setDate(d.getDate() + n); return ymd(d); }
function workDayOf(ts) {
  const d = new Date(ts);
  if (d.getHours() < ORA_CAMBIO_GIORNO) d.setDate(d.getDate() - 1);
  return ymd(d);
}
const todayKey = () => workDayOf(Date.now());
function tsFromDayTime(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = parseYmd(day);
  d.setHours(h, m, 0, 0);
  if (h < ORA_CAMBIO_GIORNO) d.setDate(d.getDate() + 1); // dopo mezzanotte = stesso turno
  return d.getTime();
}
const fmtTime = ts => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fmtDate = k => { const d = parseYmd(k); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`; };
const fmtDateFull = k => { const d = parseYmd(k); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fmtLong = k => parseYmd(k).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function fmtHours(h) { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`; }

/* ===================== Utilità importi ===================== */
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const fmtCents = c => nf2.format(c / 100);
const fmtShort = c => (c % 100 === 0 ? nf0.format(c / 100) : nf2.format(c / 100));
const fmtEuro = c => `${fmtShort(c)} €`;
const plainNum = c => (c / 100).toFixed(2).replace('.', ',');   // per export (niente separatore migliaia)

const metodi = () => db.methods;
function methodInfo(nome) {
  return metodi().find(m => m.nome === nome)
    || (db.oldMethods[nome] && { nome, ...db.oldMethods[nome] })   // metodo tolto: tiene il suo colore
    || { nome, colore: '#636366', bordo: '#8e8e93' };
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
// Versione più luminosa del colore, per bordino e pallini ben visibili sul nero
function brighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = Math.min(.93, Math.max(l + .18, .6));
  const f = t => {
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    t = (t + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(h + 1 / 3) + f(h) + f(h - 1 / 3);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ===================== Query ===================== */
const byTs = (a, b) => a.ts - b.ts;
const paymentsOf = day => db.payments.filter(p => p.day === day).sort(byTs);
const paymentsBetween = (from, to) => db.payments.filter(p => p.day >= from && p.day <= to).sort(byTs);
const sum = ps => ps.reduce((s, p) => s + p.cents, 0);

function byMethod(ps) {
  const names = metodi().map(m => m.nome);
  ps.forEach(p => { if (!names.includes(p.method)) names.push(p.method); });
  return names.map(nome => {
    const list = ps.filter(p => p.method === nome);
    return { ...methodInfo(nome), cents: sum(list), count: list.length };
  });
}

// Orari del turno.
// Inizio = "Inizia turno" se premuto, altrimenti primo incasso - 20 min.
// Fine   = "Fine turno" se premuto, altrimenti ultimo incasso.
const shiftOf = day => db.shifts[day] || {};
function hourlyOf(day) {
  const ps = paymentsOf(day);
  if (!ps.length) return null;
  const sh = shiftOf(day);
  const first = ps[0].ts, last = ps[ps.length - 1].ts;
  // il turno comprende sempre tutte le corse (es. "Inizia" premuto in ritardo)
  const start = sh.start ? Math.min(sh.start, first) : first - MINUTI_PRIMA_CORSA * 60000;
  const end = sh.end ? Math.max(sh.end, last) : last;
  const hours = Math.max((end - start) / 3600000, 1 / 60);
  // "manuale" solo se l'orario usato è davvero quello premuto (non allargato dalle corse)
  return { start, end, hours, startManual: !!sh.start && sh.start <= first, endManual: !!sh.end && sh.end >= last, perHour: sum(ps) / hours };
}
// Turno iniziato e non ancora finito (anche se nel frattempo sono passate le 4:00)
function openShiftDay() {
  let best = null;
  Object.entries(db.shifts).forEach(([day, s]) => {
    if (s.start && !s.end && Date.now() - s.start < 20 * 3600000 && (!best || s.start > db.shifts[best].start)) best = day;
  });
  return best;
}

/* ===================== Stato UI ===================== */
let viewDay = todayKey();
let lastToday = viewDay;
let entry = { cents: 0, method: null };

/* ===================== Conferme e avvisi (dentro l'app) =====================
   Niente confirm()/alert() del browser: in alcune situazioni (app sulla Home,
   anteprime) vengono chiusi da soli e l'azione non parte. */
function ask(text, { ok = 'Conferma', danger = false, cancel = 'Annulla' } = {}) {
  return new Promise(resolve => {
    const dlg = $('dialog'), okBtn = $('dialogOk'), noBtn = $('dialogCancel');
    $('dialogText').textContent = text;
    okBtn.textContent = ok;
    okBtn.className = danger ? 'danger-btn' : 'primary-btn';
    noBtn.textContent = cancel;
    noBtn.hidden = cancel === null;
    dlg.hidden = false;
    const done = v => {
      dlg.hidden = true;
      okBtn.onclick = noBtn.onclick = dlg.onclick = null;
      resolve(v);
    };
    okBtn.onclick = () => done(true);
    noBtn.onclick = () => done(false);
    dlg.onclick = e => { if (e.target === dlg) done(false); };
  });
}
const notify = text => ask(text, { ok: 'OK', cancel: null });

/* ===================== Fogli (bottom sheet) ===================== */
const backdrop = $('backdrop');
const stack = [];
function openSheet(el, { dim = true } = {}) {
  if (stack.includes(el)) return;
  const z = 11 + stack.length * 2;
  el.style.zIndex = z;
  backdrop.style.zIndex = z - 1;
  backdrop.classList.toggle('clear', !dim);
  stack.push(el);
  el.style.transform = '';
  el.classList.add('open');
  backdrop.classList.add('on');
}
function closeSheet(el = stack[stack.length - 1]) {
  if (!el) return;
  const i = stack.indexOf(el);
  if (i >= 0) stack.splice(i, 1);
  el.classList.remove('open');
  el.style.transform = '';
  if (el._onClose) { const f = el._onClose; el._onClose = null; f(); }
  const top = stack[stack.length - 1];
  if (top) { backdrop.style.zIndex = parseInt(top.style.zIndex, 10) - 1; backdrop.classList.remove('clear'); }
  else backdrop.classList.remove('on');
}
backdrop.addEventListener('click', () => closeSheet());

// Trascina verso il basso per chiudere
document.querySelectorAll('.sheet').forEach(sheet => {
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', e => {
    if (!e.target.closest('.sheet-grip, .sheet-title, .keypad-head, .cal-head')) return;
    y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 === null) return;
    y0 = null; sheet.style.transition = '';
    if (dy > 90) closeSheet(sheet); else sheet.style.transform = '';
  });
});

/* ===================== Tastierino (stile POS) ===================== */
let kp = null;
function openKeypad(opts) {
  kp = opts;
  $('keypadTitle').textContent = opts.title;
  updateKeypadPreview();
  $('keypadSheet')._onClose = () => { const done = kp && kp.onDone; kp = null; if (done) done(); };
  openSheet($('keypadSheet'), { dim: opts.dim !== false });
}
function updateKeypadPreview() {
  if (kp) $('keypadPreview').textContent = kp.euro ? fmtEuro(kp.get()) : `${fmtCents(kp.get())} €`;
}
document.querySelectorAll('.keypad button').forEach(b => b.addEventListener('click', () => {
  if (!kp) return;
  const k = b.dataset.k;
  // euro: true = solo euro interi (benzina): premi 2 e 5 e ottieni 25 €
  const unit = kp.euro ? 100 : 1;
  const v = Math.floor(kp.get() / unit);
  if (k === 'C') kp.set(0);
  else if (k === 'B') kp.set(Math.floor(v / 10) * unit);
  else { const n = (v * 10 + Number(k)) * unit; if (n <= MAX_CENTS) kp.set(n); }
  updateKeypadPreview();
}));
$('keypadDone').addEventListener('click', () => closeSheet($('keypadSheet')));

/* ===================== Schermata principale ===================== */
function renderTop() {
  $('dateLabel').textContent = fmtDate(viewDay);
  const past = viewDay !== todayKey();
  $('dateBtn').classList.toggle('past', past);
  $('todayBtn').hidden = !past;
  const fuel = db.fuel[viewDay] || 0;
  $('fuelVal').textContent = fuel ? fmtEuro(fuel) : '—';
  $('fuelBtn').classList.toggle('empty', !fuel);
  $('totVal').textContent = fmtEuro(sum(paymentsOf(viewDay)));
  renderShiftBtn();
}

function renderEntry() {
  const a = $('amountBtn');
  $('amountVal').textContent = fmtCents(entry.cents);
  a.classList.toggle('zero', entry.cents === 0);
  // Numero il più grande possibile: si rimpicciolisce solo se non ci sta in larghezza
  const base = 128;
  a.style.fontSize = base + 'px';
  const avail = $('app').clientWidth - 32 - 8;
  const w = a.scrollWidth;
  if (w > avail) a.style.fontSize = Math.max(40, Math.floor(base * avail / w)) + 'px';

  const box = $('methods');
  box.classList.toggle('has-sel', !!entry.method);
  box.querySelectorAll('.method-btn').forEach(b => b.classList.toggle('sel', b.dataset.m === entry.method));
  $('confirmBtn').disabled = !(entry.cents > 0 && entry.method);
}

function buildMethodButtons(box, onPick) {
  if (onPick) box._onPick = onPick;
  box.innerHTML = '';
  metodi().forEach(m => {
    const b = document.createElement('button');
    b.className = 'method-btn';
    b.dataset.m = m.nome;
    b.textContent = m.nome;
    b.style.setProperty('--m-bg', rgba(m.colore, .30));
    b.style.setProperty('--m-bg-strong', rgba(m.colore, .55));
    b.style.setProperty('--m-border', m.bordo);
    b.addEventListener('click', () => box._onPick(m.nome));
    box.appendChild(b);
  });
}
buildMethodButtons($('methods'), nome => {
  entry.method = entry.method === nome ? null : nome;
  renderEntry();
});

$('amountBtn').addEventListener('click', () => openKeypad({
  title: 'Importo', dim: false,
  get: () => entry.cents,
  set: v => { entry.cents = v; renderEntry(); },
}));

$('fuelBtn').addEventListener('click', () => openKeypad({
  title: viewDay === todayKey() ? 'Benzina di oggi' : `Benzina del ${fmtDate(viewDay)}`,
  euro: true,
  get: () => db.fuel[viewDay] || 0,
  set: v => { if (v) db.fuel[viewDay] = v; else delete db.fuel[viewDay]; save(); renderTop(); },
}));

/* ----- Conferma + annulla ----- */
let toastTimer = null, toastUndo = null;
$('confirmBtn').addEventListener('click', () => {
  if (!(entry.cents > 0 && entry.method)) return;
  if (viewDay !== todayKey()) {        // giorno passato: chiedi l'orario
    openEdit(null, { day: viewDay, cents: entry.cents, method: entry.method, fromEntry: true });
    return;
  }
  const now = Date.now();
  const p = { id: uid(), cents: entry.cents, method: entry.method, ts: now, day: workDayOf(now) };
  db.payments.push(p); save();
  entry = { cents: 0, method: null };
  showToast(`${fmtEuro(p.cents)} · ${p.method}`, () => {
    db.payments = db.payments.filter(x => x.id !== p.id); save();
    entry = { cents: p.cents, method: p.method };   // torna l'importo e il metodo per correggere
  });
  renderAll(p.id);
});
// onUndo = cosa fare se si preme "Annulla"
function showToast(text, onUndo) {
  const t = $('toast');
  toastUndo = onUndo || null;
  $('toastText').textContent = text;
  t.hidden = false;
  $('confirmBtn').style.visibility = 'hidden';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, DURATA_ANNULLA_MS);
  drawToastRing(t);
}
// Bordino bianco tutto intorno al popup che si consuma nel tempo in cui si può annullare
function drawToastRing(t) {
  const old = t.querySelector('.toast-ring');
  if (old) old.remove();
  const w = t.offsetWidth, h = t.offsetHeight, i = 0.75, r = h / 2 - i;
  const x0 = i, y0 = i, x1 = w - i, y1 = h - i;
  const d = `M ${w / 2} ${y0} H ${x1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} H ${x0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`;
  t.insertAdjacentHTML('afterbegin',
    `<svg class="toast-ring" viewBox="0 0 ${w} ${h}" aria-hidden="true">
       <path d="${d}" pathLength="100" style="animation-duration:${DURATA_ANNULLA_MS}ms"/></svg>`);
}
function hideToast() {
  $('toast').hidden = true;
  $('confirmBtn').style.visibility = '';
  toastUndo = null;
}
$('undoBtn').addEventListener('click', () => {
  const undo = toastUndo;
  hideToast();
  if (undo) { undo(); renderAll(); }
});

/* ----- Turno: inizio e fine ----- */
// Cosa fa il pulsantino in alto nel giorno che si sta guardando
function shiftBtnState() {
  const open = openShiftDay();
  const today = todayKey();
  if (open && (viewDay === today || viewDay === open)) return { mode: 'running', day: open };
  const sh = shiftOf(viewDay);
  if (viewDay === today && !sh.start) return { mode: 'idle', day: today };
  return { mode: 'done', day: viewDay };
}
// Interruttore: taxi verde in alto (inizia) -> bandierina rossa più in basso (finisci) -> sparisce a turno finito
let shiftShown, shiftAnimating = false;
function renderShiftBtn() {
  if (shiftAnimating) return;
  const b = $('shiftBtn'), mode = shiftBtnState().mode;
  const show = mode === 'idle' ? 'go' : mode === 'running' ? 'stop' : null;
  if (show === shiftShown) return;
  const firstRender = shiftShown === undefined;
  const prev = shiftShown;
  shiftShown = show;
  if (!show) { b.hidden = true; b.className = 'shift-switch'; return; }
  b.hidden = false;
  // all'apertura dell'app niente animazioni: l'icona è già al suo posto
  b.className = 'shift-switch' + (show === 'stop' ? ' on' : '') + (firstRender ? ' still' : '');
  if (!firstRender && show === 'go' && prev !== 'go') { void b.offsetWidth; b.classList.add('pop'); }
  b.setAttribute('aria-label', show === 'go' ? 'Inizia turno' : 'Finisci turno');
}
$('shiftBtn').addEventListener('click', () => {
  if (shiftAnimating) return;
  const st = shiftBtnState();
  const b = $('shiftBtn');
  b.classList.remove('still');
  if (st.mode === 'running') {
    // l'interruttore svanisce, poi viene nascosto
    shiftAnimating = true;
    b.classList.add('leaving');
    setTimeout(() => { shiftAnimating = false; renderShiftBtn(); }, 420);
  }
  if (st.mode === 'idle') {
    const now = Date.now(), day = workDayOf(now);
    const prev = db.shifts[day];
    db.shifts[day] = { ...(prev || {}), start: now };
    delete db.shifts[day].end;
    save();
    showToast(`Turno iniziato alle ${fmtTime(now)}`, () => {
      if (prev) db.shifts[day] = prev; else delete db.shifts[day];
      save();
    });
    renderAll();
  } else if (st.mode === 'running') {
    const now = Date.now(), day = st.day;
    db.shifts[day].end = now;
    save();
    showToast(`Turno finito · ${fmtHours((now - db.shifts[day].start) / 3600000)}`, () => {
      delete db.shifts[day].end;
      save();
    });
    renderAll();
  }
});

// Foglio per correggere gli orari del turno (vuoto = calcolo automatico)
let shiftEditDay = null;
function openShiftEdit(day) {
  shiftEditDay = day;
  const sh = shiftOf(day);
  $('shiftTitle').textContent = `Turno · ${fmtDate(day)}`;
  $('shiftStart').value = sh.start ? fmtTime(sh.start) : '';
  $('shiftEnd').value = sh.end ? fmtTime(sh.end) : '';
  renderShiftHints();
  openSheet($('shiftSheet'));
}
function renderShiftHints() {
  const ps = paymentsOf(shiftEditDay);
  $('shiftStartHint').textContent = $('shiftStart').value ? '' :
    ps.length ? `Automatico: ${fmtTime(ps[0].ts - MINUTI_PRIMA_CORSA * 60000)} (${MINUTI_PRIMA_CORSA} min prima del primo incasso)` : 'Automatico: 20 min prima del primo incasso';
  $('shiftEndHint').textContent = $('shiftEnd').value ? '' :
    ps.length ? `Automatico: ${fmtTime(ps[ps.length - 1].ts)} (ultimo incasso)` : 'Automatico: ultimo incasso';
}
$('shiftStart').addEventListener('input', renderShiftHints);
$('shiftEnd').addEventListener('input', renderShiftHints);
$('shiftStartClear').addEventListener('click', () => { $('shiftStart').value = ''; renderShiftHints(); });
$('shiftEndClear').addEventListener('click', () => { $('shiftEnd').value = ''; renderShiftHints(); });
$('shiftSave').addEventListener('click', () => {
  const day = shiftEditDay;
  const s = $('shiftStart').value, e = $('shiftEnd').value;
  const start = s ? tsFromDayTime(day, s) : null;
  const end = e ? tsFromDayTime(day, e) : null;
  const ps = paymentsOf(day);
  const realStart = start || (ps.length ? ps[0].ts - MINUTI_PRIMA_CORSA * 60000 : null);
  const realEnd = end || (ps.length ? ps[ps.length - 1].ts : null);
  if (realStart && realEnd && realEnd <= realStart) {
    return notify('La fine del turno deve essere dopo l\'inizio.');
  }
  if (start || end) {
    db.shifts[day] = {};
    if (start) db.shifts[day].start = start;
    if (end) db.shifts[day].end = end;
  } else {
    delete db.shifts[day];
  }
  save();
  closeSheet($('shiftSheet'));
  renderAll();
});

/* ----- Rotella pagamenti ----- */
const wheel = $('wheel');
let wheelItems = [], wheelKey = '', wheelSel = -1;
function renderWheel(focusId) {
  const ps = paymentsOf(viewDay);
  const key = viewDay + '|' + ps.map(p => p.id + p.cents + p.method).join(',');
  $('wheelWrap').style.visibility = ps.length ? '' : 'hidden';
  if (key === wheelKey && !focusId) return;
  const prevId = wheelItems[wheelSel] && wheelItems[wheelSel].id;
  const sameDay = wheelKey.split('|')[0] === viewDay;
  wheelKey = key;
  wheelItems = ps;
  wheel.innerHTML = ps.map((p, i) => {
    const m = methodInfo(p.method);
    return `<div class="wheel-item" data-i="${i}">
      <svg class="pen" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>
      <span>${fmtShort(p.cents)}</span><i class="dot" style="background:${m.bordo}"></i></div>`;
  }).join('');
  let idx = ps.length - 1;                                  // di default il più recente
  const want = focusId || (sameDay ? prevId : null);
  const found = ps.findIndex(p => p.id === want);
  if (found >= 0) idx = found;
  wheel.scrollTop = idx * ROW_H;
  wheelSel = -1;
  updateWheel();
}
function updateWheel() {
  const st = wheel.scrollTop;
  const sel = Math.max(0, Math.min(wheelItems.length - 1, Math.round(st / ROW_H)));
  const els = wheel.children;
  for (let i = 0; i < els.length; i++) {
    const off = (i * ROW_H - st) / ROW_H;                  // distanza dal centro in righe
    const a = Math.max(-3, Math.min(3, off));
    els[i].style.transform = `perspective(260px) rotateX(${-a * 20}deg) scale(${1 - Math.abs(a) * 0.06})`;
    if (i === sel) els[i].classList.add('sel'); else els[i].classList.remove('sel');
  }
  wheelSel = sel;
}
let wheelRaf = 0;
wheel.addEventListener('scroll', () => { cancelAnimationFrame(wheelRaf); wheelRaf = requestAnimationFrame(updateWheel); }, { passive: true });
wheel.addEventListener('click', e => {
  const it = e.target.closest('.wheel-item');
  if (!it) return;
  const i = Number(it.dataset.i);
  if (i === wheelSel) openEdit(wheelItems[i].id);
  else wheel.scrollTo({ top: i * ROW_H, behavior: 'smooth' });
});

/* ===================== Modifica / aggiungi pagamento ===================== */
let ed = null;
buildMethodButtons($('editMethods'), nome => { if (ed) { ed.method = nome; renderEdit(); } });
function openEdit(id, preset) {
  if (id) {
    const p = db.payments.find(x => x.id === id);
    if (!p) return;
    ed = { id, day: p.day, cents: p.cents, method: p.method, time: fmtTime(p.ts) };
  } else {
    const ps = paymentsOf(preset.day);
    const time = preset.day === todayKey() ? fmtTime(Date.now()) : (ps.length ? fmtTime(ps[ps.length - 1].ts) : '21:00');
    ed = { id: null, day: preset.day, cents: preset.cents || 0, method: preset.method || null, time, fromEntry: !!preset.fromEntry };
  }
  $('editTitle').textContent = (ed.id ? 'Modifica pagamento' : 'Nuovo pagamento') + ' · ' + fmtDate(ed.day);
  $('editDelete').textContent = ed.id ? 'Elimina' : 'Annulla';
  $('editTime').value = ed.time;
  renderEdit();
  openSheet($('editSheet'));
}
function renderEdit() {
  $('editAmount').textContent = `${fmtCents(ed.cents)} €`;
  const box = $('editMethods');
  box.classList.toggle('has-sel', !!ed.method);
  box.querySelectorAll('.method-btn').forEach(b => b.classList.toggle('sel', b.dataset.m === ed.method));
  $('editSave').disabled = !(ed.cents > 0 && ed.method);
  $('editSave').style.opacity = $('editSave').disabled ? .4 : 1;
}
$('editAmount').addEventListener('click', () => openKeypad({
  title: 'Importo',
  get: () => ed.cents,
  set: v => { ed.cents = v; renderEdit(); },
}));
$('editTime').addEventListener('change', e => { if (ed && e.target.value) ed.time = e.target.value; });
$('editSave').addEventListener('click', () => {
  if (!ed || !(ed.cents > 0 && ed.method)) return;
  const ts = tsFromDayTime(ed.day, ed.time);
  let focus;
  if (ed.id) {
    const p = db.payments.find(x => x.id === ed.id);
    Object.assign(p, { cents: ed.cents, method: ed.method, ts, day: workDayOf(ts) });
    focus = p.id;
  } else {
    const p = { id: uid(), cents: ed.cents, method: ed.method, ts, day: workDayOf(ts) };
    db.payments.push(p); focus = p.id;
    if (ed.fromEntry) entry = { cents: 0, method: null };
  }
  save();
  closeSheet($('editSheet'));
  renderAll(focus);
});
$('editDelete').addEventListener('click', async () => {
  if (!ed) return;
  if (ed.id) {
    const id = ed.id;
    const p = db.payments.find(x => x.id === id);
    if (!p) return;
    const yes = await ask(`Eliminare il pagamento di ${fmtEuro(p.cents)} (${p.method}) delle ${fmtTime(p.ts)}?`, { ok: 'Elimina', danger: true });
    if (!yes) return;
    db.payments = db.payments.filter(x => x.id !== id); save();
  }
  closeSheet($('editSheet'));
  renderAll();
});

/* ===================== Grafici e blocchi riutilizzabili ===================== */
function methodBlock(ps) {
  const total = sum(ps);
  const rows = byMethod(ps).filter(m => m.cents > 0 || metodi().some(x => x.nome === m.nome));
  const bar = rows.filter(m => m.cents > 0)
    .map(m => `<i style="flex:${m.cents};background:${m.bordo}"></i>`).join('');
  return `<div class="stackbar">${bar}</div>` + rows.map(m => `
    <div class="mrow ${m.cents ? '' : 'zero'}">
      <i class="dot" style="background:${m.bordo}"></i>
      <span class="name">${esc(m.nome)}<small>${m.count ? m.count + '×' : ''}</small></span>
      <span class="val">${fmtEuro(m.cents)}<small>${total ? Math.round(m.cents / total * 100) + '%' : ''}</small></span>
    </div>`).join('');
}

function donut(ps) {
  const total = sum(ps);
  if (!total) return '';
  const r = 70, c = 2 * Math.PI * r;
  let off = 0;
  const segs = byMethod(ps).filter(m => m.cents > 0).map(m => {
    const len = m.cents / total * c;
    const s = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${m.bordo}" stroke-width="26"
      stroke-dasharray="${Math.max(len - 2, 0.5)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)"/>`;
    off += len;
    return s;
  }).join('');
  return `<svg class="chart" viewBox="0 0 200 200" style="max-width:220px;margin:0 auto">${segs}
    <text x="100" y="94" text-anchor="middle" style="font-size:13px">Totale</text>
    <text x="100" y="119" text-anchor="middle" style="font-size:22px;fill:#f5f5f7;font-weight:700">${fmtEuro(total)}</text></svg>`;
}

// Barre impilate per giorno (o per mese se il periodo è lungo)
function barChart(from, to, ps, width) {
  const days = [];
  for (let k = from; k <= to; k = addDays(k, 1)) days.push(k);
  let buckets;
  if (days.length > 62) {
    const map = new Map();
    days.forEach(k => { const mk = k.slice(0, 7); if (!map.has(mk)) map.set(mk, []); });
    buckets = [...map.keys()].map(mk => ({
      label: parseYmd(mk + '-01').toLocaleDateString('it-IT', { month: 'short' }),
      ps: ps.filter(p => p.day.startsWith(mk)),
    }));
  } else {
    buckets = days.map(k => ({ label: String(parseYmd(k).getDate()), ps: ps.filter(p => p.day === k) }));
  }
  const H = 190, top = 24, bottom = 26, W = Math.max(260, width);
  const max = Math.max(...buckets.map(b => sum(b.ps)), 1);
  const slot = W / buckets.length, bw = Math.max(3, Math.min(28, slot * 0.7));
  const every = Math.ceil(buckets.length / 7);           // al massimo ~7 etichette sotto
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  // linea tratteggiata al valore massimo, con l'importo sopra
  svg += `<line x1="0" x2="${W}" y1="${top}" y2="${top}" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 4"/>`;
  svg += `<text x="0" y="${top - 7}">max ${fmtEuro(max)}</text>`;
  svg += `<line x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" stroke="rgba(255,255,255,.14)"/>`;
  buckets.forEach((b, i) => {
    const x = i * slot + (slot - bw) / 2;
    let y = H - bottom;
    byMethod(b.ps).forEach(m => {
      if (!m.cents) return;
      const h = m.cents / max * (H - top - bottom);
      y -= h;
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h - 1, 0.5)}" rx="2" fill="${m.bordo}"/>`;
    });
    if (i % every === 0) svg += `<text x="${x + bw / 2}" y="${H - 7}" text-anchor="middle">${b.label}</text>`;
  });
  return svg + '</svg>';
}

const penSvg = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>';
// stesse icone dell'interruttore del turno (index.html)
const taxiSvg = '<svg viewBox="0 0 24 24"><path d="M10 3.5h4v2h-4z"/><path d="M5.5 11l1.4-3.9A2.2 2.2 0 0 1 9 5.5h6a2.2 2.2 0 0 1 2.1 1.6l1.4 3.9"/><rect x="3.5" y="11" width="17" height="6" rx="2"/><path d="M7.5 14h.01M16.5 14h.01M6.5 17v2M17.5 17v2"/></svg>';
const flagSvg = '<svg viewBox="0 0 24 24"><path d="M6 21V3.5"/><path d="M6 4.5c2.5-1.3 4.5-1.3 6.5 0s4 1.3 6.5 0v8c-2.5 1.3-4.5 1.3-6.5 0s-4-1.3-6.5 0"/></svg>';
const clockLineSvg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const pumpSvg = '<svg viewBox="0 0 24 24"><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M7 7h5M15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/></svg>';

/* ===================== Riepilogo giornata (TOT) ===================== */
function renderTotSheet() {
  const ps = paymentsOf(viewDay);
  const total = sum(ps);
  const hr = hourlyOf(viewDay);
  const fuel = db.fuel[viewDay] || 0;
  $('totSheetDate').textContent = '· ' + fmtDate(viewDay);
  let h = `<div class="big-total">${fmtEuro(total)}</div>`;
  if (fuel) h += `<div class="fuel-note">${pumpSvg} Benzina messa: ${fmtEuro(fuel)}</div>`;
  h += `<div class="kpis">
    <div class="kpi"><b>${ps.length}</b><span>pagamenti</span></div>
    <div class="kpi"><b>${hr ? fmtEuro(Math.round(hr.perHour)) : '—'}</b><span>media oraria</span></div>
    <div class="kpi"><b>${hr ? fmtHours(hr.hours) : '—'}</b><span>ore</span></div>
  </div>`;
  // Inizio/fine con la stessa icona dello schermo principale (taxi / bandierina);
  // orologio se l'orario è calcolato in automatico
  if (hr) h += `<button class="shift-note" id="totShift">
      <span class="shift-times">
        <span class="st go">Inizio ${fmtTime(hr.start)} ${hr.startManual ? taxiSvg : clockLineSvg}</span>
        <span class="st stop">Fine ${fmtTime(hr.end)} ${hr.endManual ? flagSvg : clockLineSvg}</span>
      </span>
      <span class="edit-link">${penSvg} modifica orari</span></button>`;
  h += `<div class="section-label">Per metodo</div>` + methodBlock(ps);
  h += `<div class="section-label">Pagamenti</div>`;
  h += ps.length ? ps.slice().reverse().map(p => {
    const m = methodInfo(p.method);
    return `<button class="prow" data-id="${p.id}"><span class="time">${fmtTime(p.ts)}</span>
      <i class="dot" style="background:${m.bordo}"></i><span>${esc(p.method)}</span>
      <span class="val">${fmtEuro(p.cents)}</span>${penSvg}</button>`;
  }).join('') : `<div class="empty-msg">Nessun pagamento</div>`;
  h += `<button class="secondary-btn add-btn" id="totAdd">+ Aggiungi pagamento</button>`;
  $('totSheetBody').innerHTML = h;
}
$('totSheetBody').addEventListener('click', e => {
  const row = e.target.closest('.prow');
  if (row) return openEdit(row.dataset.id);
  if (e.target.closest('#totAdd')) openEdit(null, { day: viewDay });
  if (e.target.closest('#totShift')) openShiftEdit(viewDay);
});
$('totBtn').addEventListener('click', () => { renderTotSheet(); openSheet($('totSheet')); });

/* ===================== Calendario ===================== */
let calMonth = null;
function renderCal() {
  const { y, m } = calMonth;
  $('calTitle').textContent = new Date(y, m, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const totals = {};
  db.payments.forEach(p => { totals[p.day] = (totals[p.day] || 0) + p.cents; });
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;                 // lunedì = 0
  const nDays = new Date(y, m + 1, 0).getDate();
  const today = todayKey();
  let h = '<span></span>'.repeat(lead);
  for (let d = 1; d <= nDays; d++) {
    const k = ymd(new Date(y, m, d));
    const cls = ['cal-day', totals[k] ? 'has' : '', k === today ? 'today' : '', k === viewDay ? 'view' : '', k > today ? 'future' : ''].join(' ');
    h += `<button class="${cls}" data-k="${k}" ${k > today ? 'disabled' : ''}>${d}<small>${totals[k] ? fmtShort(totals[k]) : ''}</small></button>`;
  }
  $('calGrid').innerHTML = h;
}
function shiftCal(dir) { const d = new Date(calMonth.y, calMonth.m + dir, 1); calMonth = { y: d.getFullYear(), m: d.getMonth() }; renderCal(); }
$('calPrev').addEventListener('click', () => shiftCal(-1));
$('calNext').addEventListener('click', () => shiftCal(1));
$('calGrid').addEventListener('click', e => {
  const b = e.target.closest('.cal-day');
  if (!b || b.disabled) return;
  viewDay = b.dataset.k;
  closeSheet($('calSheet'));
  renderAll();
});
$('calToday').addEventListener('click', () => { viewDay = todayKey(); closeSheet($('calSheet')); renderAll(); });
$('dateBtn').addEventListener('click', () => {
  const d = parseYmd(viewDay);
  calMonth = { y: d.getFullYear(), m: d.getMonth() };
  renderCal();
  openSheet($('calSheet'));
});
$('todayBtn').addEventListener('click', () => { viewDay = todayKey(); renderAll(); });

/* ===================== Selettore periodo ===================== */
function PeriodPicker(container, defaultMode, onChange) {
  const st = { mode: defaultMode, anchor: todayKey(), from: addDays(todayKey(), -6), to: todayKey() };
  const modes = [['day', 'Giorno'], ['week', 'Settimana'], ['month', 'Mese'], ['range', 'Periodo']];
  function range() {
    const a = parseYmd(st.anchor);
    if (st.mode === 'day') return [st.anchor, st.anchor];
    if (st.mode === 'week') { const mon = addDays(st.anchor, -((a.getDay() + 6) % 7)); return [mon, addDays(mon, 6)]; }
    if (st.mode === 'month') return [ymd(new Date(a.getFullYear(), a.getMonth(), 1)), ymd(new Date(a.getFullYear(), a.getMonth() + 1, 0))];
    return st.from <= st.to ? [st.from, st.to] : [st.to, st.from];
  }
  function label() {
    const [f, t] = range();
    const short = k => parseYmd(k).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    if (st.mode === 'day') return parseYmd(f).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    if (st.mode === 'week') return `${short(f)} – ${short(t)} ${parseYmd(t).getFullYear()}`;
    return parseYmd(f).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  }
  function shift(dir) {
    if (st.mode === 'day') st.anchor = addDays(st.anchor, dir);
    else if (st.mode === 'week') st.anchor = addDays(st.anchor, 7 * dir);
    else { const a = parseYmd(st.anchor); st.anchor = ymd(new Date(a.getFullYear(), a.getMonth() + dir, 1)); }
    render(); onChange();
  }
  function render() {
    let h = `<div class="seg">${modes.map(([v, l]) => `<button data-v="${v}" class="${st.mode === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (st.mode === 'range') {
      h += `<div class="period-range"><label>Dal<input type="date" data-f="from" value="${st.from}"></label>
            <label>Al<input type="date" data-f="to" value="${st.to}"></label></div>`;
    } else {
      h += `<div class="period-nav"><button class="icon-btn" data-d="-1"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
            <span>${label()}</span><button class="icon-btn" data-d="1"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>`;
    }
    container.innerHTML = h;
  }
  container.addEventListener('click', e => {
    const m = e.target.closest('.seg button');
    if (m) { st.mode = m.dataset.v; render(); onChange(); return; }
    const d = e.target.closest('[data-d]');
    if (d) shift(Number(d.dataset.d));
  });
  container.addEventListener('change', e => {
    const f = e.target.dataset.f;
    if (f && e.target.value) { st[f] = e.target.value; onChange(); }
  });
  render();
  return { range, render, reset() { st.anchor = todayKey(); render(); } };
}

/* ===================== Statistiche ===================== */
const statsPicker = PeriodPicker($('statsPicker'), 'week', renderStats);
function renderStats() {
  const [from, to] = statsPicker.range();
  const ps = paymentsBetween(from, to);
  const body = $('statsBody');
  if (!ps.length) { body.innerHTML = `<div class="empty-msg">Nessun pagamento in questo periodo</div>`; return; }
  const total = sum(ps);
  const workedDays = [...new Set(ps.map(p => p.day))];
  let h = `<div class="big-total">${fmtEuro(total)}</div>`;
  if (from === to) {
    const hr = hourlyOf(from);
    h += `<div class="kpis">
      <div class="kpi"><b>${ps.length}</b><span>pagamenti</span></div>
      <div class="kpi"><b>${fmtEuro(Math.round(hr.perHour))}</b><span>media oraria</span></div>
      <div class="kpi"><b>${fmtHours(hr.hours)}</b><span>ore</span></div></div>`;
  } else {
    const hours = workedDays.reduce((s, d) => s + hourlyOf(d).hours, 0);
    const dayTotals = workedDays.map(d => ({ d, c: sum(ps.filter(p => p.day === d)) }));
    const best = dayTotals.reduce((a, b) => (b.c > a.c ? b : a));
    let fuel = 0;
    Object.keys(db.fuel).forEach(k => { if (k >= from && k <= to) fuel += db.fuel[k]; });
    h += `<div class="kpis">
      <div class="kpi"><b>${workedDays.length}</b><span>giorni lavorati</span></div>
      <div class="kpi"><b>${fmtEuro(Math.round(total / workedDays.length))}</b><span>media al giorno</span></div>
      <div class="kpi"><b>${fmtEuro(Math.round(total / hours))}</b><span>media oraria</span></div>
      <div class="kpi"><b>${ps.length}</b><span>pagamenti</span></div>
      <div class="kpi"><b>${fmtEuro(best.c)}</b><span>miglior giorno (${fmtDate(best.d).slice(0, 5)})</span></div>
      <div class="kpi"><b>${fuel ? fmtEuro(fuel) : '—'}</b><span>benzina</span></div></div>`;
    h += `<div class="section-label">Andamento</div>` + barChart(from, to, ps, (body.clientWidth || 358) - 32);
  }
  h += `<div class="section-label">Per metodo</div>` + donut(ps) + methodBlock(ps);
  body.innerHTML = h;
}
$('openStats').addEventListener('click', () => {
  closeSheet($('menuSheet'));
  statsPicker.reset();
  openSheet($('statsSheet'));
  requestAnimationFrame(renderStats);
});

/* ===================== Esporta ===================== */
const exportPicker = PeriodPicker($('exportPicker'), 'day', renderExport);
const exp = { format: 'csv', kind: 'days' };
function segBind(id, key) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    exp[key] = b.dataset.v;
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderExport();
  });
}
segBind('exportFormat', 'format');
segBind('exportKind', 'kind');

function exportTable() {
  const [from, to] = exportPicker.range();
  const ps = paymentsBetween(from, to);
  if (exp.kind === 'all') {
    const rows = ps.map(p => [fmtDateFull(p.day), fmtTime(p.ts), p.method, plainNum(p.cents)]);
    rows.push(['Totale', '', '', plainNum(sum(ps))]);
    return { head: ['Data', 'Ora', 'Metodo', 'Importo'], rows };
  }
  const names = byMethod(ps).filter(m => m.cents > 0 || metodi().some(x => x.nome === m.nome)).map(m => m.nome);
  const days = [...new Set([...ps.map(p => p.day), ...Object.keys(db.fuel).filter(k => k >= from && k <= to)])].sort();
  const rows = days.map(d => {
    const dp = ps.filter(p => p.day === d);
    return [fmtDateFull(d), ...names.map(n => plainNum(sum(dp.filter(p => p.method === n)))), plainNum(sum(dp)), plainNum(db.fuel[d] || 0)];
  });
  if (days.length > 1) {
    let fuel = 0; days.forEach(d => { fuel += db.fuel[d] || 0; });
    rows.push(['Totale', ...names.map(n => plainNum(sum(ps.filter(p => p.method === n)))), plainNum(sum(ps)), plainNum(fuel)]);
  }
  return { head: ['Data', ...names, 'Totale', 'Benzina'], rows };
}
function exportText(sep) {
  const { head, rows } = exportTable();
  if (exp.format === 'md') {
    const line = r => `| ${r.join(' | ')} |`;
    return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n') + '\n';
  }
  const cell = v => (/[";\t\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [head, ...rows].map(r => r.map(cell).join(sep)).join('\n') + '\n';
}
function renderExport() {
  const { rows } = exportTable();
  $('exportPreview').textContent = rows.length > 1 || exp.kind === 'days' && rows.length ? exportText(';') : 'Nessun dato in questo periodo';
}
$('openExport').addEventListener('click', () => {
  closeSheet($('menuSheet'));
  exportPicker.reset();
  renderExport();
  openSheet($('exportSheet'));
});

async function shareFile(name, text, mime) {
  const file = new File([text], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}
function flash(btn, text) { const old = btn.textContent; btn.textContent = text; setTimeout(() => { btn.textContent = old; }, 1500); }

$('exportShare').addEventListener('click', () => {
  const [from, to] = exportPicker.range();
  const name = `conti_${from}${from !== to ? '_' + to : ''}.${exp.format}`;
  const text = exp.format === 'csv' ? '﻿' + exportText(';') : exportText();
  shareFile(name, text, exp.format === 'csv' ? 'text/csv' : 'text/plain');
});
$('exportCopy').addEventListener('click', async () => {
  const ok = await copyText(exp.format === 'csv' ? exportText('\t') : exportText());
  flash($('exportCopy'), ok ? 'Copiato ✓' : 'Errore');
});

/* ===================== Backup ===================== */
function renderBackupInfo() {
  const lb = db.lastBackup;
  const days = lb ? Math.floor((Date.now() - lb) / 86400000) : null;
  $('backupInfo').textContent =
    (lb ? `Ultimo backup: ${fmtDate(ymd(new Date(lb)))} (${days === 0 ? 'oggi' : days === 1 ? 'ieri' : days + ' giorni fa'}).` : 'Nessun backup ancora salvato.') +
    ' Il backup è un file che puoi salvare in "File" o iCloud Drive. Con "Ripristina" lo ricarichi, anche su un telefono nuovo.';
}
$('menuBtn').addEventListener('click', () => { renderBackupInfo(); openSheet($('menuSheet')); });
$('backupBtn').addEventListener('click', async () => {
  const data = { app: 'AppConti', v: 1, exportedAt: new Date().toISOString(), payments: db.payments, fuel: db.fuel, shifts: db.shifts, methods: db.methods, oldMethods: db.oldMethods };
  const ok = await shareFile(`conti-backup-${todayKey()}.json`, JSON.stringify(data), 'application/json');
  if (ok) { db.lastBackup = Date.now(); save(); renderBackupInfo(); }
});
$('restoreBtn').addEventListener('click', () => $('restoreInput').click());
$('restoreInput').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const ok = d && Array.isArray(d.payments) && d.payments.every(p =>
      p && typeof p.id === 'string' && Number.isInteger(p.cents) && typeof p.method === 'string' && typeof p.ts === 'number' && typeof p.day === 'string');
    if (!ok) throw new Error('formato');
    const yes = await ask(`Sostituire i dati attuali (${db.payments.length} pagamenti) con quelli del backup (${d.payments.length} pagamenti)?`, { ok: 'Ripristina', danger: true });
    if (!yes) return;
    db.payments = d.payments;
    db.fuel = d.fuel && typeof d.fuel === 'object' ? d.fuel : {};
    db.shifts = d.shifts && typeof d.shifts === 'object' ? d.shifts : {};
    const validM = Array.isArray(d.methods) && d.methods.length &&
      d.methods.every(m => m && typeof m.nome === 'string' && /^#[0-9a-f]{6}$/i.test(m.colore) && /^#[0-9a-f]{6}$/i.test(m.bordo));
    if (validM) db.methods = d.methods.map(m => ({ nome: m.nome, colore: m.colore, bordo: m.bordo }));
    if (d.oldMethods && typeof d.oldMethods === 'object') db.oldMethods = d.oldMethods;
    db.lastBackup = Date.now();
    save();
    closeSheet($('menuSheet'));
    methodsChanged();
    notify('Backup ripristinato.');
  } catch (err) {
    notify('Questo file non è un backup valido.');
  }
});

/* ===================== Impostazioni: metodi di pagamento ===================== */
const PALETTE = [
  '#1c9614', '#c20606', '#d9d2d2', '#e0cb0b', '#db7807', '#8f0646', '#2b107d', '#0a84ff',
  '#30b0c7', '#5e5ce6', '#bf5af2', '#ff375f', '#a2845e', '#636366', '#34c759', '#ffffff',
];
const trashSvg = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
const upSvg = '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>';
const downSvg = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';

function methodsChanged() {
  save();
  if (entry.method && !metodi().some(m => m.nome === entry.method)) entry.method = null;
  buildMethodButtons($('methods'));
  buildMethodButtons($('editMethods'));
  wheelKey = '';                         // ridisegna i pallini con i nuovi colori
  renderAll();
  if ($('methodsSheet').classList.contains('open')) renderMethodsSettings();
}

function renderMethodsSettings() {
  const list = metodi();
  $('methodsList').innerHTML = list.map((m, i) => `
    <div class="set-row" data-i="${i}">
      <button class="swatch" data-act="color" style="background:${rgba(m.colore, .45)};border-color:${m.bordo}" aria-label="Colore"></button>
      <input class="name-input" data-act="name" value="${esc(m.nome)}" maxlength="14" autocomplete="off" autocapitalize="words">
      <button class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Su">${upSvg}</button>
      <button class="icon-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Giù">${downSvg}</button>
      <button class="icon-btn del" data-act="del" aria-label="Togli">${trashSvg}</button>
    </div>`).join('') + `
    <button class="secondary-btn add-btn" data-act="add">+ Aggiungi metodo</button>
    <p class="muted small-text">Tocca il pallino per cambiare colore e il nome per rinominarlo. Se rinomini un metodo, anche i pagamenti già registrati prendono il nuovo nome. Se lo togli, i pagamenti già registrati restano nello storico.</p>`;
}

$('methodsList').addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.tagName === 'INPUT') return;
  const act = btn.dataset.act;
  const row = btn.closest('.set-row');
  const i = row ? Number(row.dataset.i) : -1;
  const list = metodi();
  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    methodsChanged();
  } else if (act === 'del') {
    if (list.length <= 1) return notify('Serve almeno un metodo di pagamento.');
    const m = list[i];
    const yes = await ask(`Togliere "${m.nome}"? I pagamenti già registrati con questo metodo restano nello storico.`, { ok: 'Togli', danger: true });
    if (!yes) return;
    db.oldMethods[m.nome] = { colore: m.colore, bordo: m.bordo };
    list.splice(i, 1);
    methodsChanged();
  } else if (act === 'add') {
    let nome = 'Nuovo', n = 2;
    while (list.some(m => m.nome.toLowerCase() === nome.toLowerCase())) nome = `Nuovo ${n++}`;
    const used = new Set(list.map(m => m.colore.toLowerCase()));
    const colore = PALETTE.find(c => !used.has(c)) || PALETTE[0];
    list.push({ nome, colore, bordo: brighten(colore) });
    methodsChanged();
    const inp = $('methodsList').querySelector(`.set-row[data-i="${list.length - 1}"] .name-input`);
    if (inp) { inp.focus(); inp.select(); }
  } else if (act === 'color') {
    openColorPicker(i);
  }
});

$('methodsList').addEventListener('change', e => {
  if (!e.target.classList.contains('name-input')) return;
  const i = Number(e.target.closest('.set-row').dataset.i);
  const m = metodi()[i];
  const nuovo = e.target.value.trim().replace(/\s+/g, ' ');
  if (!nuovo || nuovo === m.nome) { e.target.value = m.nome; return; }
  if (metodi().some((x, j) => j !== i && x.nome.toLowerCase() === nuovo.toLowerCase())) {
    e.target.value = m.nome;
    return notify(`Esiste già un metodo chiamato "${nuovo}".`);
  }
  const vecchio = m.nome;
  db.payments.forEach(p => { if (p.method === vecchio) p.method = nuovo; });   // lo storico segue il nuovo nome
  if (entry.method === vecchio) entry.method = nuovo;
  m.nome = nuovo;
  methodsChanged();
});
$('methodsList').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList.contains('name-input')) e.target.blur();
});

let colorIdx = -1;
function openColorPicker(i) {
  colorIdx = i;
  const cur = metodi()[i].colore.toLowerCase();
  $('colorTitle').textContent = `Colore di ${metodi()[i].nome}`;
  $('swatches').innerHTML = PALETTE.map(c =>
    `<button class="swatch big ${c === cur ? 'on' : ''}" data-c="${c}" style="background:${rgba(c, .45)};border-color:${brighten(c)}"></button>`).join('');
  $('customColor').value = cur;
  openSheet($('colorSheet'));
}
function setColor(c) {
  const m = metodi()[colorIdx];
  if (!m) return;
  const orig = METODI_INIZIALI.find(x => x.colore.toLowerCase() === c.toLowerCase());
  m.colore = c;
  m.bordo = orig ? orig.bordo : brighten(c);   // i colori originali tengono il bordino scelto a mano
  methodsChanged();
}
$('swatches').addEventListener('click', e => {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  setColor(b.dataset.c);
  closeSheet($('colorSheet'));
});
$('customColor').addEventListener('change', e => { setColor(e.target.value); closeSheet($('colorSheet')); });

$('openMethods').addEventListener('click', () => {
  closeSheet($('menuSheet'));
  renderMethodsSettings();
  openSheet($('methodsSheet'));
});

/* ===================== Render generale ===================== */
function renderAll(focusId) {
  renderTop();
  renderEntry();
  renderWheel(focusId);
  if ($('totSheet').classList.contains('open')) renderTotSheet();
  if ($('statsSheet').classList.contains('open')) renderStats();
  renderBackupInfo();
}

// Cambio giornata alle 4:00 anche con l'app aperta
function checkDayChange() {
  const t = todayKey();
  if (t !== lastToday) {
    if (viewDay === lastToday) viewDay = t;
    lastToday = t;
    renderAll();
  } else if ($('totSheet').classList.contains('open') && viewDay === t) {
    renderTotSheet(); // aggiorna la media oraria
  }
}
setInterval(checkDayChange, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayChange(); });
window.addEventListener('resize', renderEntry);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderEntry);

renderAll();

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
