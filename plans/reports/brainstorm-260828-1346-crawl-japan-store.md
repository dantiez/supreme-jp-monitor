# Cách crawl được cửa hàng Supreme Nhật

Ngày 2026-08-28. Dự án: supreme-jp-monitor.

## Vấn đề

supreme.com chọn **thị trường theo IP người gọi**. Mỗi thị trường đặt **mã sản phẩm khác nhau** cho cùng một món, mà tool theo dõi bằng mã đó — nên quét từ sai nước sẽ ghi đè toàn bộ catalogue Nhật bằng của nước khác.

Đã xảy ra thật 2 lần (26–27/8): 268 món bị gỡ + 267 món "mới" cho một cửa hàng không đổi gì.

## Sự thật đã kiểm chứng

| | |
|---|---|
| Host khu vực có thật | `jp`, `us`, `uk`, `eu`, `kr`, `cn` (không có `sg`) |
| Ghi đè bằng URL/path | `/ja/`, `/en-jp/` → **404** |
| Ghi đè bằng tham số | `?country=JP` → bị bỏ qua |
| Ghi đè bằng header | `Accept-Language: ja-JP` → bị bỏ qua |
| Ghi đè bằng cookie | `localization=JP`, `localization=SG` → **đều bị bỏ qua** |
| Việt Nam (Viettel) | → cửa hàng **JPY** ✅ |
| Render Singapore | → cửa hàng **SGD** ❌ |
| Render có region Tokyo | Không (Oregon, Ohio, Virginia, Frankfurt, Singapore) |

**Không có cách nào ở tầng request.** Chỉ còn hai đòn bẩy: IP đi ra, và lớp chặn.

## Điều đã thay đổi cuộc chơi

Sau khi gộp ghi DB, một lần quét giờ là:

- **2 request HTTP** tới Supreme (~1 MB)
- **~5 giây** tổng cộng (trước là 121 giây)

Nên bài toán không còn là "cần một máy chủ ở Nhật chạy 24/7", mà là **"cần 2 request xuất phát từ IP thuộc thị trường Nhật, vài lần một ngày"**. Rất nhỏ. Điều này mở ra serverless, vốn trước đây không khả thi vì timeout.

## Các nhóm giải pháp

### A. Chạy app trên host thuộc thị trường Nhật

| Cách | Tiền | Thẻ? | Công sức | Ghi chú |
|---|---|---|---|---|
| **Google Cloud Run** `asia-northeast1` | ~0đ (free tier 2tr req/tháng) | Có | Trung bình | Quét 5s vừa khít serverless |
| **AWS Lambda** `ap-northeast-1` | ~0đ (free tier) | Có | Trung bình | Cần API Gateway cho dashboard |
| **Fly.io** `nrt` | ~$2–3/tháng | Có | Thấp (đã có Dockerfile) | Đã dựng sẵn cấu hình rồi bỏ |
| **Oracle Cloud Free** `ap-tokyo-1` | 0đ vĩnh viễn | Có (xác minh) | **Cao** — dựng VM, firewall, HTTPS | Oracle hay thu hồi máy free |
| **VPS Nhật** (Sakura, ConoHa, Vultr Tokyo) | ~$3–6/tháng | Có | Cao | Tự quản lý toàn bộ |

### B. Chỉ đẩy request Supreme qua IP Nhật (proxy)

Giữ Render, chỉ 2 request đi vòng.

| Cách | Tiền | Đánh giá |
|---|---|---|
| Proxy datacenter Nhật | ~$1–5/tháng | Rẻ, nhưng chưa rõ Shopify có đối xử khác với IP datacenter không |
| Proxy dân cư Nhật | $3–15/GB | Đắt, thừa thãi cho 1 MB/lần |
| Tailscale exit node ở máy Nhật | 0đ | **Cần có sẵn một máy ở Nhật** — anh không có |
| Proxy miễn phí trên mạng | 0đ | **Không nên.** Không tin cậy, và đẩy dữ liệu qua máy lạ |

### C. Quét từ máy đã chạy được (máy anh ở VN)

Đây là thứ vừa xây rồi gỡ.

| Cách | Tiền | Đánh giá |
|---|---|---|
| Chạy tay `npm run scan` | 0đ | **Đang dùng.** Bạn anh không tự làm mới được |
| Hàng đợi + worker launchd | 0đ | Đã xây, đã gỡ theo yêu cầu. Bạn anh có nút thật, đổi lại 1 agent nền + phải chuyển repo ra khỏi ~/Downloads |
| Máy bạn/người quen ở Nhật | 0đ | Nếu có ai ở Nhật cho chạy nhờ |

### D. Không nhắm cửa hàng Nhật nữa

Loại. Bạn anh bán lại hàng Nhật, không thay thế được.

## Khuyến nghị

**Nếu chấp nhận thêm thẻ:** Google Cloud Run `asia-northeast1`. Quét 5 giây nằm gọn trong free tier, không phải quản máy, và app đã có Dockerfile-able. Fly.io `nrt` đơn giản hơn nhưng tốn ~$3/tháng.

**Nếu không thêm thẻ:** quay lại hàng đợi + worker (nhóm C). Đó là cách duy nhất miễn phí mà bạn anh vẫn có nút bấm.

## Mẹo quan trọng: mọi phương án đều thử được trong 10 giây

Lớp chặn sai cửa hàng biến câu hỏi "host này có vào được cửa hàng Nhật không?" thành một phép thử một dòng. Chạy trên host ứng viên:

```bash
curl -s https://jp.supreme.com/collections/new \
  -H 'User-Agent: Mozilla/5.0' | grep -o "meta.currency = '[A-Z]*'"
```

Ra `JPY` → dùng được. Ra gì khác → bỏ, chưa tốn xu nào.

Vì Shopify ánh xạ IP→thị trường mịn hơn 6 host khu vực, **đừng đoán theo địa lý** — cứ thử.

## Rủi ro

- Ánh xạ IP→thị trường của Supreme có thể đổi bất cứ lúc nào. Lớp chặn sẽ bắt được, nhưng host đang dùng có thể ngưng hoạt động.
- Free tier (Cloud Run, Oracle) có thể bị thu hẹp.
- Proxy datacenter có thể bị chặn nếu Supreme siết.

## Câu hỏi chưa có lời

1. Anh có sẵn sàng thêm thẻ vào một nhà cung cấp nào không? Đây là điểm rẽ duy nhất.
2. Có ai quen ở Nhật cho chạy nhờ một tiến trình nhỏ không? Nếu có thì miễn phí và bền.
3. Bạn anh cần nút bấm đến mức nào — hay xem dữ liệu được làm mới định kỳ là đủ?
