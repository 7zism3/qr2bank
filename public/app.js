import { parseVietQR, buildDeeplink } from './emvco-parser.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const KEY = { app: 'q2b.appId', cam: 'q2b.deviceId', banks: 'q2b.banks', apps: 'q2b.apps', edit: 'q2b.edit', note: 'q2b.defNote', wallet: 'q2b.wallet', walletType: 'q2b.walletType', nogate: 'q2b.nogate' };
const QR_SCANNER_URL = 'https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js';

const video = $('video');
const statusEl = $('status');
let stream = null;
let track = null;
let cams = [];
let scanning = false;
let found = false;
let detector = null;
let QrScannerLib = null;
let bankList = []; // [{bin, code}]

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

function setStatus(msg, err = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', err);
}

/* ---------- Decoder ---------- */
async function initDecoder() {
  if ('BarcodeDetector' in window) {
    try {
      const fmts = await BarcodeDetector.getSupportedFormats();
      if (fmts.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch { /* dùng fallback */ }
  }
}

async function loadQrScanner() {
  if (!QrScannerLib) QrScannerLib = (await import(QR_SCANNER_URL)).default;
  return QrScannerLib;
}

async function decode(source) {
  if (detector) {
    try {
      const r = await detector.detect(source);
      if (r.length) return r[0].rawValue;
      if (source === video) return null;
    } catch { /* thử fallback */ }
  }
  try {
    const QS = await loadQrScanner();
    const r = await QS.scanImage(source, { returnDetailedScanResult: true });
    return r.data;
  } catch {
    return null;
  }
}

/* ---------- Camera ---------- */
function stopCamera() {
  scanning = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = track = null;
}

function pickMainBack(list) {
  const back = list.filter((d) => /back|rear|environment|sau/i.test(d.label));
  const pool = back.length ? back : list;
  const good = pool.filter((d) => !/ultra|wide|tele|macro|depth|zoom/i.test(d.label));
  return (good[0] || pool[0] || {}).deviceId;
}

async function openStream(deviceId) {
  const video_ = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: 'environment' } };
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { ...video_, width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: 'continuous' }] },
  });
}

async function startCamera() {
  stopCamera();
  found = false;
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Trình duyệt không hỗ trợ camera (cần HTTPS)', true);
    return;
  }
  try {
    let wanted = store.get(KEY.cam);
    try {
      stream = await openStream(wanted || undefined);
    } catch (e) {
      if (!wanted) throw e;
      store.del(KEY.cam); // deviceId cũ không còn hợp lệ
      wanted = null;
      stream = await openStream();
    }
    // Chỉ sau khi cấp quyền thì enumerateDevices mới có label
    const all = await navigator.mediaDevices.enumerateDevices();
    cams = all.filter((d) => d.kind === 'videoinput');
    const backCams = cams.filter((d) => /back|rear|environment|sau/i.test(d.label));
    if (backCams.length) cams = backCams;
    let curId = stream.getVideoTracks()[0].getSettings().deviceId;
    if (!wanted) {
      const best = pickMainBack(cams);
      if (best && best !== curId) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await openStream(best);
        curId = best;
      }
    }
    track = stream.getVideoTracks()[0];
    video.srcObject = stream;
    await video.play();
    setupControls();
    $('switchBtn').hidden = cams.length < 2;
    setStatus('Đưa mã VietQR vào khung');
    scanning = true;
    requestAnimationFrame(loop);
  } catch (e) {
    const denied = e.name === 'NotAllowedError';
    setStatus(denied ? 'Bạn đã chặn quyền camera. Hãy cấp quyền rồi tải lại.' : `Không mở được camera: ${e.message}`, true);
  }
}

function setupControls() {
  const caps = track.getCapabilities?.() || {};
  const zoomRow = $('zoomRow');
  const z = $('zoom');
  if (caps.zoom) {
    z.min = caps.zoom.min;
    z.max = caps.zoom.max;
    z.step = caps.zoom.step || 0.1;
    z.value = track.getSettings().zoom || caps.zoom.min;
    zoomRow.hidden = false;
  } else zoomRow.hidden = true;
  $('torchBtn').hidden = !caps.torch;
  torchOn = false;
  $('torchBtn').classList.remove('on');
  if (caps.focusMode?.includes('continuous')) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }
}

$('zoom').addEventListener('input', (e) => {
  track?.applyConstraints({ advanced: [{ zoom: Number(e.target.value) }] }).catch(() => {});
});

let torchOn = false;
$('torchBtn').addEventListener('click', async () => {
  if (!track) return;
  const btn = $('torchBtn');
  const next = !torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: next }] });
    torchOn = next;
    btn.classList.toggle('on', torchOn);
  } catch { /* không hỗ trợ */ }
});

$('switchBtn').addEventListener('click', async () => {
  if (cams.length < 2) return;
  const cur = track?.getSettings().deviceId;
  const i = cams.findIndex((d) => d.deviceId === cur);
  const next = cams[(i + 1) % cams.length];
  store.set(KEY.cam, next.deviceId); // nhớ ống kính đã chọn
  await startCamera();
  setStatus(`Ống kính: ${next.label || 'camera'}`);
});

/* ---------- Vòng quét ---------- */
let lastTick = 0;
let busy = false;
async function loop(ts) {
  if (!scanning) return;
  if (!busy && ts - lastTick > 120 && video.readyState >= 2) {
    lastTick = ts;
    busy = true;
    try {
      const raw = await decode(video);
      if (raw && scanning) handleResult(raw);
    } finally {
      busy = false;
    }
  }
  requestAnimationFrame(loop);
}

/* ---------- Xử lý kết quả ---------- */
function handleResult(raw) {
  if (found) return;
  const info = parseVietQR(raw);
  if (!info) {
    setStatus('Đây không phải mã VietQR chuyển khoản', true);
    return;
  }
  const appId = store.get(KEY.app);
  if (!appId) {
    setStatus('Chưa chọn ngân hàng mặc định', true);
    openSettings();
    return;
  }
  const bank = bankList.find((b) => b.bin === info.bin);
  if (!bank) {
    setStatus(`Không nhận diện được ngân hàng nhận (BIN ${info.bin})`, true);
    return;
  }
  const target = { appId, bankCode: bank.code.toLowerCase(), account: info.account, amount: info.amount, note: info.note };
  // Bật chế độ sửa -> hiện bảng nhập. Tắt -> mở thẳng; thiếu tiền thì gửi 0đ, thiếu nội dung thì dùng mặc định.
  const defNote = store.get(KEY.note) || '';
  if (!target.note && defNote) target.note = defNote;
  if (store.get(KEY.edit) === '1') {
    stopCamera();
    showSheet(target, bank);
    return;
  }
  if (!target.amount) target.amount = '0';
  go(target);
}

function go(t, gesture = false) {
  // Chrome Android chặn mở app (intent) khi trang chưa từng được chạm: cần 1 lần chạm (sticky activation).
  if (!gesture && store.get(KEY.nogate) !== '1' && navigator.userActivation && !navigator.userActivation.hasBeenActive) {
    stopCamera();
    pendingGo = t;
    $('tap').hidden = false;
    return;
  }
  found = true;
  scanning = false;
  navigator.vibrate?.(60);
  setStatus('Đang mở ngân hàng…');
  window.location.replace(buildDeeplink({ ...t, returnUrl: location.origin + '/' }));
}

let pending = null;
// Căn bảng nhập vào giữa phần màn hình còn nhìn thấy (trừ bàn phím).
function fitSheet() {
  const s = $('sheet');
  const vv = window.visualViewport;
  if (!vv || s.hidden) return;
  s.style.top = `${vv.offsetTop}px`;
  s.style.bottom = 'auto';
  s.style.height = `${vv.height}px`;
}
window.visualViewport?.addEventListener('resize', fitSheet);
window.visualViewport?.addEventListener('scroll', fitSheet);
let pendingGo = null;
$('tapForm').addEventListener('submit', (e) => e.preventDefault());
// Chạm bất kỳ đâu trên lớp phủ (trừ nút "Quét lại") là mở ngân hàng.
$('tap').addEventListener('click', (e) => {
  if (e.target.closest('#tapCancel')) return;
  $('tap').hidden = true;
  go(pendingGo, true);
});
$('tapCancel').addEventListener('click', () => {
  $('tap').hidden = true;
  startCamera();
});
function showSheet(t, bank) {
  pending = t;
  $('sheetTo').textContent = `Tới ${t.account} (${bank.code})`;
  $('amt').value = t.amount || '';
  $('note').value = t.note || '';
  $('sheet').hidden = false;
  fitSheet();
  setTimeout(() => {
    const f = $('amt').value ? $('note') : $('amt');
    f.focus();
  }, 50);
}
$('sheetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = $('amt').value.replace(/\D/g, '');
  go({ ...pending, amount: amount || null, note: $('note').value.trim() || null });
});
$('sheetCancel').addEventListener('click', () => {
  $('sheet').hidden = true;
  startCamera();
});

/* ---------- Ảnh từ thư viện / clipboard ---------- */
async function decodeBlob(blob) {
  setStatus('Đang đọc ảnh…');
  let raw = null;
  if (detector) {
    try {
      const bmp = await createImageBitmap(blob);
      raw = await decode(bmp);
    } catch { /* fallback */ }
  }
  if (!raw) raw = await decode(blob);
  if (raw) {
    found = false;
    handleResult(raw);
  } else setStatus('Không tìm thấy mã QR trong ảnh', true);
}

$('pickBtn').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) decodeBlob(f);
});
$('pasteBtn').addEventListener('click', async () => {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return decodeBlob(await item.getType(type));
    }
    setStatus('Clipboard không có ảnh', true);
  } catch {
    setStatus('Không đọc được clipboard (hãy cấp quyền)', true);
  }
});
document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) decodeBlob(f);
});

/* ---------- Dữ liệu ngân hàng ---------- */
async function cachedJSON(url, key) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    store.set(key, JSON.stringify(json));
    return json;
  } catch {
    const c = store.get(key);
    return c ? JSON.parse(c) : null;
  }
}

async function loadBanks() {
  const json = await cachedJSON('https://api.vietqr.io/v2/banks', KEY.banks);
  bankList = (json?.data || []).map((b) => ({ bin: String(b.bin), code: b.code }));
}

async function loadApps() {
  const url = `https://api.vietqr.io/v2/${isIOS ? 'ios' : 'android'}-app-deeplinks`;
  const json = await cachedJSON(url, `${KEY.apps}.${isIOS ? 'ios' : 'android'}`);
  return json?.apps || json?.data || [];
}

/* ---------- Cài đặt ---------- */
async function openSettings() {
  stopCamera();
  $('scanView').hidden = true;
  $('settingsView').hidden = false;
  const sel = $('bankSel');
  if (!sel.options.length) {
    sel.innerHTML = '<option>Đang tải…</option>';
    const apps = await loadApps();
    if (!apps.length) {
      sel.innerHTML = '';
      $('bankHint').textContent = 'Không tải được danh sách ngân hàng. Kiểm tra mạng.';
      return;
    }
    const saved = store.get(KEY.app);
    sel.innerHTML =
      '<option value="">— Chọn ngân hàng —</option>' +
      apps
        .sort((a, b) => (a.appName || '').localeCompare(b.appName || ''))
        .map((a) => `<option value="${a.appId}"${a.appId === saved ? ' selected' : ''}>${a.appName || a.appId}${a.bankName ? ' – ' + a.bankName : ''}</option>`)
        .join('');
  }
  $('bankHint').textContent = store.get(KEY.app) ? `Đang dùng: ${store.get(KEY.app)}` : '';
}

$('nogateTgl').checked = store.get(KEY.nogate) === '1';
$('nogateTgl').addEventListener('change', (e) => store.set(KEY.nogate, e.target.checked ? '1' : '0'));
$('editTgl').checked = store.get(KEY.edit) === '1';
$('defNote').value = store.get(KEY.note) || '';
$('editTgl').addEventListener('change', (e) => store.set(KEY.edit, e.target.checked ? '1' : '0'));
$('defNote').addEventListener('input', (e) => store.set(KEY.note, e.target.value.trim()));
$('bankSel').addEventListener('change', (e) => {
  if (e.target.value) {
    store.set(KEY.app, e.target.value);
    $('bankHint').textContent = `Đã lưu: ${e.target.value}`;
  }
});
$('resetCam').addEventListener('click', () => {
  store.del(KEY.cam);
  $('bankHint').textContent = 'Đã quên ống kính. Lần mở sau sẽ tự chọn lại.';
});
$('settingsBtn').addEventListener('click', openSettings);
$('backBtn').addEventListener('click', () => {
  $('settingsView').hidden = true;
  $('scanView').hidden = false;
  startCamera();
});

// Quay lại từ app ngân hàng (bfcache/tab ẩn) -> quét tiếp; ẩn tab -> tắt camera.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
  else if (!$('scanView').hidden) startCamera();
});

/* ---------- Cài đặt ứng dụng (PWA) ---------- */
let installEvt = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

function refreshInstallUI() {
  const btn = $('installBtn');
  const hint = $('installHint');
  hint.hidden = true;
  btn.hidden = true;
  $('installCard').hidden = !!standalone;
  if (standalone) return;
  if (installEvt) btn.hidden = false;
  else if (isIOS) {
    hint.hidden = false;
    hint.textContent = 'Trên iPhone: mở bằng Safari, bấm nút Chia sẻ (□↑) → "Thêm vào Màn hình chính".';
  } else {
    btn.hidden = false; // Chrome chưa cho cài tự động: hướng dẫn thủ công khi bấm
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  refreshInstallUI();
});
window.addEventListener('appinstalled', () => {
  installEvt = null;
  $('installBtn').hidden = true;
  $('installHint').hidden = false;
  $('installHint').textContent = 'Đã cài đặt. Mở QR2Bank từ màn hình chính.';
});
$('installBtn').addEventListener('click', async () => {
  if (installEvt) {
    installEvt.prompt();
    await installEvt.userChoice;
    installEvt = null;
    refreshInstallUI();
  } else {
    $('installHint').hidden = false;
    $('installHint').textContent = 'Bấm menu ⋮ của trình duyệt → "Cài đặt ứng dụng" hoặc "Thêm vào màn hình chính".';
  }
});

/* ---------- Smart Posture Routing: mở Ví thẻ khi cầm ngang / nằm phẳng ---------- */
const WALLETS = { google: 'com.google.android.apps.walletnfcrel', samsung: 'com.samsung.android.spay' };

$('walletTgl').checked = store.get(KEY.wallet) === '1';
$('walletOpts').hidden = !$('walletTgl').checked;
$('walletSel').value = store.get(KEY.walletType) || 'google';
$('walletTgl').addEventListener('change', (e) => {
  store.set(KEY.wallet, e.target.checked ? '1' : '0');
  $('walletOpts').hidden = !e.target.checked;
});
$('walletSel').addEventListener('change', (e) => store.set(KEY.walletType, e.target.value));

// Đọc góc máy đúng 1 lần, tối đa 150ms; không có dữ liệu thì coi như tư thế bình thường.
function readOrientationOnce() {
  return new Promise((resolve) => {
    if (!('DeviceOrientationEvent' in window)) return resolve(null);
    const done = (v) => {
      clearTimeout(timer);
      window.removeEventListener('deviceorientation', onEvt);
      resolve(v);
    };
    const onEvt = (e) => done(e);
    const timer = setTimeout(() => done(null), 150);
    window.addEventListener('deviceorientation', onEvt, { once: true });
  });
}

function isWalletPosture(e) {
  const landscape = screen.orientation?.type?.startsWith('landscape');
  if (landscape) return true;
  if (!e || e.beta == null || e.gamma == null) return false;
  return Math.abs(e.beta) < 25 || Math.abs(e.gamma) > 50;
}

// Trả true nếu đã chuyển hướng sang ví.
async function routeByPosture() {
  const url = new URL(location.href);
  // Quay lại từ fallback (chưa cài ví / bị chặn): bỏ cờ rồi quét bình thường, tránh lặp vô hạn.
  if (url.searchParams.has('nw')) {
    url.searchParams.delete('nw');
    history.replaceState(null, '', url.pathname + url.search);
    return false;
  }
  if (store.get(KEY.wallet) !== '1') return false;
  if (!isWalletPosture(await readOrientationOnce())) return false;
  // Chrome chặn intent khi chưa có thao tác chạm: hiện nút để người dùng chạm rồi mới mở ví.
  $('walletGate').hidden = false;
  return true;
}

function walletPkg() {
  return WALLETS[store.get(KEY.walletType)] || WALLETS.google;
}
function walletBack() {
  const b = new URL(location.href);
  b.searchParams.set('nw', '1');
  return encodeURIComponent(b.href);
}
$('walletTest').addEventListener('click', () => openWallet());
$('walletTestD').addEventListener('click', () => {
  location.href = `intent://launch#Intent;scheme=samsungpay;package=com.samsung.android.spay;S.browser_fallback_url=${walletBack()};end`;
});
$('walletTestE').addEventListener('click', () => {
  location.href = 'samsungpay://launch';
});
$('walletTestF').addEventListener('click', () => {
  location.href = `intent://pay.google.com/gp/v/home#Intent;scheme=https;package=com.google.android.apps.walletnfcrel;S.browser_fallback_url=${walletBack()};end`;
});
$('sensorTest').addEventListener('click', async () => {
  const out = $('sensorOut');
  out.textContent = 'Đang đọc…';
  try {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission();
  } catch { /* bỏ qua */ }
  const e = await readOrientationOnce();
  const r = (n) => (n == null ? 'null' : n.toFixed(1));
  out.textContent =
    `screen.orientation: ${screen.orientation?.type || 'không có'}\n` +
    `DeviceOrientationEvent: ${'DeviceOrientationEvent' in window ? 'có' : 'không có'}\n` +
    `Nhận sự kiện trong 150ms: ${e ? 'có' : 'KHÔNG'}\n` +
    `beta=${r(e?.beta)}  gamma=${r(e?.gamma)}\n` +
    `Kết luận: ${isWalletPosture(e) ? 'ĐÚNG tư thế mở ví' : 'KHÔNG phải tư thế mở ví'}`;
});

function openWallet() {
  const back = walletBack();
  if (store.get(KEY.walletType) !== 'samsung') {
    location.href = `intent://pay.google.com/gp/v/home#Intent;scheme=https;package=com.google.android.apps.walletnfcrel;S.browser_fallback_url=${back};end`;
    return;
  }
  // Samsung Wallet nguội không nhận link ngay: nhịp 1 đánh thức, nhịp 2 gọi lại nếu trang vẫn còn hiển thị.
  location.href = `intent://launch#Intent;scheme=samsungpay;package=com.samsung.android.spay;S.browser_fallback_url=${back};end`;
  setTimeout(() => {
    if (!document.hidden) location.href = 'samsungpay://launch';
  }, 1500);
}
$('walletForm').addEventListener('submit', (e) => e.preventDefault());
// Chạm bất kỳ đâu (trừ nút "Quét QR") là mở ví.
$('walletGate').addEventListener('click', (e) => {
  if (e.target.closest('#walletSkip')) return;
  openWallet();
});
$('walletSkip').addEventListener('click', () => {
  $('walletGate').hidden = true;
  startCamera();
});

/* ---------- Khởi động ---------- */
refreshInstallUI();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  if (await routeByPosture()) return;
  startCamera();
  await initDecoder();
  await loadBanks();
  if (!store.get(KEY.app)) setStatus('Vào ⚙️ để chọn ngân hàng mặc định trước khi quét');
})();
