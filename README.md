# QR2Bank - Quick QR Scanner

Quét VietQR bằng camera và mở thẳng app ngân hàng với thông tin chuyển khoản điền sẵn. Ứng dụng là một PWA tĩnh (Vanilla JS, không framework) chạy trên Cloudflare Workers.

**Phiên bản 2.0.1 (thử nghiệm)** · Phát triển bởi **7zism3**

## Link

| Bản | Địa chỉ |
| --- | --- |
| v1 (nhánh [`main`](../../tree/main), ổn định) | https://qr2bank.7zism3.me |
| v2 (nhánh `v2`, thử nghiệm) | https://qr2bankv2.7zism3.me |

## Tính năng

- Mở camera ngay khi vào app, giao diện tối, thao tác một tay.
- Chọn đúng ống kính sau (ưu tiên camera chính, tránh ultrawide), nút đổi ống kính và nhớ `deviceId` đã chọn.
- Thanh zoom, đèn flash và lấy nét liên tục nếu phần cứng hỗ trợ.
- Giải mã bằng `BarcodeDetector` của trình duyệt, tự fallback sang [`qr-scanner`](https://github.com/nimiq/qr-scanner) (tải từ CDN khi cần).
- Quét từ ảnh trong máy hoặc dán ảnh từ clipboard.
- Parser EMVCo/VietQR (TLV): BIN và số tài khoản (tag `38`), số tiền (tag `54`), nội dung (tag `62` → `08`), kiểm tra CRC16.
- Mở app ngân hàng qua deeplink `https://dl.vietqr.io/pay?app=…&ba=…@…&am=…&tn=…&url=…`.
- Cài đặt: ngân hàng mặc định (danh sách lấy từ API VietQR), cho phép sửa số tiền và nội dung trước khi mở, nội dung chuyển khoản mặc định, nút cài ứng dụng lên màn hình chính.

## Khác với v1

- Lớp phủ "Đã quét xong" chạm **bất kỳ đâu** trên màn hình là mở ngân hàng (chỉ nút "Quét lại" là ngoại lệ).
- Công tắc thử nghiệm **"Bỏ bước chạm, tự mở ngân hàng ngay"** trong Cài đặt (mặc định tắt) để kiểm tra trình duyệt có cho tự mở app hay không.
- **Smart Posture Routing (thử nghiệm, mặc định tắt):** đọc góc máy một lần lúc mở app; nếu máy nằm ngang/phẳng thì hiện màn hình "Chạm bất kỳ đâu để mở Ví" thay vì camera. Có các nút thử mở Samsung Wallet / Google Wallet và nút "Kiểm tra cảm biến".
  - **Giới hạn đã kiểm tra:** trên máy Samsung, web không mở được Samsung Wallet khi ví chưa chạy (đã thử intent `MAIN/LAUNCHER`, `intent://…package=`, `android-app://`, `intent://launch#Intent;scheme=samsungpay`, `samsungpay://launch`). Mở được khi ví đã chạy sẵn. Vì vậy tính năng này chưa dùng được ổn định để mở ví.

## Cách hoạt động

1. Camera giải mã chuỗi EMVCo (`000201…`).
2. `emvco-parser.js` bóc tách BIN, số tài khoản, số tiền, nội dung. BIN được đổi sang mã ngân hàng bằng `api.vietqr.io/v2/banks`.
3. App dựng link `dl.vietqr.io/pay` và chuyển hướng bằng `location.replace`, rồi trang trung gian mở app ngân hàng đã chọn.

## Lưu ý khi dùng

- **Cần chạm trang ít nhất một lần** sau khi mở app. Chrome Android (và Samsung Internet) chặn trang tự mở app ngoài khi chưa có thao tác chạm; nếu chưa chạm, app hiện lớp phủ "Đã quét xong" để bạn chạm một lần rồi mở. Chạm vào bất kỳ đâu trên màn hình là tính.
- QR tĩnh không có số tiền sẽ được gửi `am=0`. Bật "Cho sửa số tiền và nội dung" trong Cài đặt để nhập trước khi mở.
- `tn` dùng dấu `+` cho khoảng trắng và `url` để nguyên (không mã hoá), vì `dl.vietqr.io` xử lý như vậy mới ổn định.
- Camera chỉ chạy trên HTTPS hoặc `localhost`.

## Cấu trúc

```
public/
  index.html, style.css, app.js
  emvco-parser.js     # TLV parser, CRC16, dựng deeplink
  manifest.json, sw.js
  icons/
test/parser.test.mjs
wrangler.jsonc        # Cloudflare Workers static assets
```

## Chạy và deploy

```bash
npm install
npm test            # kiểm tra parser
npm run dev         # http://localhost:8787
npx wrangler login  # lần đầu
npm run deploy
```

Domain riêng khai báo trong `wrangler.jsonc` (`routes` với `custom_domain`, v2 dùng worker `qr2bank-v2`). Số phiên bản hiển thị trong Cài đặt nằm ở `public/index.html`, cache service worker ở `public/sw.js` (tăng `CACHE` mỗi lần deploy để máy người dùng lấy bản mới).

## Dữ liệu lưu trên máy (`localStorage`)

`q2b.appId` (ngân hàng mặc định), `q2b.deviceId` (ống kính), `q2b.edit` (cho sửa tiền/nội dung), `q2b.defNote` (nội dung mặc định), `q2b.nogate`, `q2b.wallet`, `q2b.walletType` (tính năng thử nghiệm), cùng bản sao danh sách ngân hàng để dùng khi offline.
