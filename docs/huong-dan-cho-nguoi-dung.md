# Bot canh hàng Supreme Nhật — hướng dẫn dùng

*Gửi cho người dùng. Không cần biết gì về kỹ thuật.*

---

## Nó làm gì cho bạn

Một trang web riêng, cho bạn xem **toàn bộ hàng trên jp.supreme.com** đang còn hay đã hết, và **so với lần quét gần nhất thì có gì đổi**.

Dùng để canh hàng bạn đã đăng bán lại: món nào vừa hết thì gỡ tin, món nào có lại thì đăng tiếp.

> ### ⚠️ Nó KHÔNG tự chạy
>
> Chỉ khi bạn bấm nút thì nó mới đi xem. Bạn không bấm thì không có gì được kiểm tra.
>
> Lúc bạn đang ngủ mà có món về hàng rồi lại hết, nó sẽ **không** biết. Đây là điểm khác so với trước đây.

---

## Lần đầu vào

1. Mở đường link được gửi cho bạn.
2. Trình duyệt hỏi tên đăng nhập và mật khẩu:
   - **Tên đăng nhập**: gõ gì cũng được (ví dụ `a`) — không ai kiểm tra
   - **Mật khẩu**: dán mật khẩu được gửi kèm
3. Chọn ghi nhớ để lần sau khỏi gõ lại.

Nếu bạn để yên link một lúc lâu rồi mới mở, **trang sẽ chờ khoảng nửa phút đến một phút mới hiện**. Bình thường, cứ đợi.

---

## Dùng hằng ngày — 3 bước

### Bước 1 — bấm nút xanh **Quét ngay**

Nút đổi thành **Đang quét…** kèm một **vòng tròn xoay**. Vòng tròn còn xoay là nó vẫn đang làm.

**Mất khoảng 2 phút.** Cứ để đấy. Chuyển tab khác rồi quay lại cũng được; đóng luôn trang cũng không sao — mở lại vẫn thấy nó đang chạy.

### Bước 2 — đọc dòng kết quả

Quét xong sẽ hiện một dòng báo:

| Dòng báo | Nghĩa là | Bạn làm gì |
|---|---|---|
| *không có gì thay đổi so với lần trước* | Y hệt lần trước | Xong, nghỉ |
| *Mất hàng: 4 vừa hết hàng* | 4 món vừa hết | Đi gỡ tin đang bán |
| *Thêm hàng: 2 có hàng lại* | 2 món về hàng | Đăng bán được |

Bấm **Xem chi tiết** để biết chính xác món nào.

### Bước 3 — hai cột

| Cột xanh — **CÒN HÀNG** | Cột đỏ — **HẾT HÀNG** |
|---|---|
| Đang mua được | Không mua được |

Mỗi dòng là **một màu, một size riêng**. Supreme coi mỗi màu là một sản phẩm khác nhau, nên `Box Logo — Black — M` và `Box Logo — White — M` là hai dòng khác nhau.

- Bấm vào tên → sang thẳng trang Supreme
- Bấm **Copy** → chép tên món để dán đi chỗ khác

**Nếu lần quét vừa rồi không có gì đổi**, cột đỏ không liệt kê nữa, chỉ hiện một dòng *"Lần quét gần nhất: không có thay đổi nào."* — vì danh sách đó y hệt lần trước, bày ra chỉ tổ rối mắt.

---

## Nút **Xem thay đổi**

Mở trang riêng, so **lần quét này với lần quét ngay trước đó** (không phải so theo ngày).

- Bên trái **Thêm hàng** (xanh): về hàng lại, hàng mới lên sàn
- Bên phải **Mất hàng** (đỏ): vừa hết, hoặc bị gỡ khỏi sàn

Có ô chọn ở trên để xem lại các lần quét cũ.

> **"Hết hàng" và "gỡ khỏi sàn" là hai chuyện khác nhau.**
> *Hết hàng* = Supreme vẫn bán món đó, tạm thời hết → có thể về lại.
> *Gỡ khỏi sàn* = Supreme không còn bán món đó nữa → đừng chờ.

---

## Tin Discord

Mỗi lần **có người bấm quét** và tìm thấy thay đổi, bot nhắn vào channel Discord. Không ai bấm thì không có tin.

Thứ tự ưu tiên trong tin: **về hàng lại** → lên lại sàn → hàng mới → size mới → đổi giá → vừa hết hàng → gỡ khỏi sàn.

Dòng đầu là tổng kết, ví dụ:

> New product: 30 (showing 10, 20 more)

Nghĩa là có **30** món mới, Discord chỉ hiện được **10** ô, còn **20** món nữa. Discord giới hạn 10 ô một tin — bot **nói rõ còn bao nhiêu** thay vì lặng lẽ giấu đi.

Mỗi ô là một món, bấm được vào tên:

```
Back in stock: AOI GORE-TEX Hooded Jacket    ← tên món, BẤM ĐƯỢC
Orange | Size Large | ¥85,800                ← màu | size | giá
```

**Back in stock là tin đáng giá nhất** — hàng Supreme về lại bay rất nhanh, thấy là bấm luôn.

---

## Tải file

- **Tải CSV** — mở bằng Excel hoặc Google Sheets
- **Tải Excel** — file `.xlsx`

File có đủ mọi thứ trên màn hình, kèm giá và đơn vị tiền.

> Cột **Currency** ghi rõ tiền gì (JPY hay USD). Trang Supreme thỉnh thoảng trả về giá đô, nên đừng nhìn con số không mà đoán là yên.
>
> Ô giá **để trống** nghĩa là không đọc được giá — **không phải** giá bằng 0.

---

## Ô lọc phía trên

- **Tất cả danh mục** → chỉ xem áo, giày, phụ kiện…
- **Mọi sự kiện** → chỉ xem món vừa về hàng, vừa hết hàng…
- **Cả hai cột** → chỉ xem cột còn hàng, hoặc chỉ cột hết hàng

Chọn xong bấm **Lọc**.

---

## Mấy điều hay hỏi

**Bấm nút hai lần cùng lúc thì sao?**
Không sao. Nó báo "Đã có một lần quét đang chạy" và bỏ qua lần bấm thứ hai.

**Hai người cùng mở link được không?**
Được, cùng nhìn một dữ liệu. Một người bấm quét thì người kia cũng thấy nó đang chạy.

**Có món ghi "chưa kiểm tra được" thì sao?**
Lúc quét bị lỗi mạng với riêng món đó. Nó **không** bị xếp vào hết hàng — vì chưa ai xác nhận điều đó. Quét lại lần sau thường là hết.

**Giờ hiển thị là giờ nào?**
Giờ Nhật (GMT+9), ghi rõ trên đầu trang.

**Đừng chia link cho người khác.** Ai có link và mật khẩu là xem được tất cả, tải được file, và bấm quét được.

---

## Khi thấy lạ

| Hiện tượng | Làm gì |
|---|---|
| Trang quay mãi lúc mới mở | Đợi 1 phút, máy chủ đang khởi động lại |
| Hỏi mật khẩu lại | Gõ lại, trình duyệt quên sau khi đóng |
| "Không gọi được máy chủ" | Tải lại trang rồi bấm quét lại |
| Vòng tròn xoay quá 5 phút | Tải lại trang; vẫn vậy thì báo người quản lý |
| Số liệu y hệt lần trước | Đúng rồi — không có gì đổi thật |
