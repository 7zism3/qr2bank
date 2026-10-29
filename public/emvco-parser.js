// Bộ giải mã EMVCo (TLV) cho VietQR / NAPAS 247.

/** Tách chuỗi TLV phẳng thành Map tag -> value. Ném lỗi nếu độ dài sai. */
export function parseTLV(str) {
  const out = {};
  let i = 0;
  while (i < str.length) {
    if (i + 4 > str.length) throw new Error('TLV bị cắt cụt');
    const tag = str.slice(i, i + 2);
    const len = parseInt(str.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len)) throw new Error('Độ dài TLV không hợp lệ');
    const value = str.slice(i + 4, i + 4 + len);
    if (value.length !== len) throw new Error('TLV vượt quá độ dài chuỗi');
    out[tag] = value;
    i += 4 + len;
  }
  return out;
}

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) theo chuẩn EMVCo. */
export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function checkCRC(raw) {
  const body = raw.slice(0, -4);
  return crc16(body) === raw.slice(-4).toUpperCase();
}

/**
 * Bóc tách VietQR. Trả về null nếu không phải QR chuyển khoản NAPAS.
 * @returns {{bin:string, account:string, amount:string|null, note:string|null,
 *            service:string|null, crcOk:boolean}|null}
 */
export function parseVietQR(raw) {
  raw = String(raw || '').trim();
  if (!raw.startsWith('0002')) return null;
  try {
    const root = parseTLV(raw);
    const merchant = root['38'];
    if (!merchant) return null;
    const t38 = parseTLV(merchant);
    if (t38['00'] !== 'A000000727') return null;
    // Sub-tag 01 lại là TLV lồng: 00 = BIN ngân hàng thụ hưởng, 01 = số TK/số thẻ
    const beneficiary = parseTLV(t38['01'] || '');
    const bin = beneficiary['00'];
    const account = beneficiary['01'];
    if (!bin || !account) return null;

    let note = null;
    if (root['62']) {
      try {
        note = parseTLV(root['62'])['08'] || null;
      } catch {
        /* bỏ qua tag 62 hỏng */
      }
    }
    return {
      bin,
      account,
      amount: root['54'] && Number(root['54']) > 0 ? String(Math.round(Number(root['54']))) : null,
      note,
      service: t38['02'] || null, // QRIBFTTA = tài khoản, QRIBFTTC = thẻ
      crcOk: checkCRC(raw),
    };
  } catch {
    return null;
  }
}

/** Tạo link dl.vietqr.io. `url` là link quay về app (tham số bắt buộc của dl.vietqr.io). */
export function buildDeeplink({ appId, bankCode, account, amount, note, returnUrl }) {
  const p = [`app=${encodeURIComponent(appId)}`, `ba=${encodeURIComponent(account)}@${encodeURIComponent(bankCode)}`];
  if (amount) p.push(`am=${encodeURIComponent(amount)}`);
  if (note) p.push(`tn=${encodeURIComponent(note).replace(/%20/g, '+')}`) // dl.vietqr.io dùng + cho khoảng trắng;
  if (returnUrl) p.push(`url=${returnUrl}`);
  return `https://dl.vietqr.io/pay?${p.join('&')}`;
}
