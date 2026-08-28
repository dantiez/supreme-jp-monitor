# Bot canh hàng Supreme Nhật — hướng dẫn dùng

*Gửi cho người dùng. Không cần biết gì về kỹ thuật.*

---

## Nó làm gì cho bạn

Một trang web riêng, cho bạn xem **toàn bộ hàng trên jp.supreme.com** đang còn hay đã hết, và **so với lần quét gần nhất thì có gì đổi**.

Dùng để canh hàng bạn đã đăng bán lại: món nào vừa hết thì gỡ tin, món nào có lại thì đăng tiếp.

> ### Bấm **Quét ngay** bất cứ lúc nào
>
> Dữ liệu cũng tự làm mới hai tiếng một lần, nên mở ra là đã có sẵn.
>
> Nhưng nó **không canh liên tục**: món về hàng lúc 3 giờ rồi hết lúc 4 giờ, kẹt giữa hai lần quét, thì nó không biết. Nên **thấy tin là xử lý ngay**.

---

## Lần đầu vào

1. Mở đường link được gửi cho bạn.
2. Trình duyệt hỏi tên đăng nhập và mật khẩu:
   - **Tên đăng nhập**: gõ gì cũng được (ví dụ `a`) — không ai kiểm tra
   - **Mật khẩu**: dán mật khẩu được gửi kèm
3. Chọn ghi nhớ để lần sau khỏi gõ lại.

Nếu bạn để yên link một lúc lâu rồi mới mở, **trang sẽ chờ khoảng nửa phút đến một phút mới hiện**. Bình thường, cứ đợi.

---

## Nút **Quét ngay**

Bấm là xong. Nút sẽ báo *"Đã gửi yêu cầu, đang chờ máy quét…"*, rồi khoảng **2–3 phút** sau dữ liệu được làm mới.

> **Vì sao phải chờ?** Trang Supreme trả về **cửa hàng khác nhau tuỳ nơi gọi**. Máy chủ chạy trang web này ở Singapore nên nó nhận cửa hàng Singapore, không phải Nhật — quét từ đó sẽ ghi nhầm dữ liệu. Nên khi bạn bấm, yêu cầu được chuyển sang một máy khác vào đúng cửa hàng Nhật, máy đó quét rồi trả kết quả về đây.

Bấm nhiều lần cũng chỉ chạy **một** lần quét, không sao cả.

Đôi khi sẽ thấy dòng *"Máy chủ này không vào được cửa hàng Nhật, đã chuyển yêu cầu sang máy quét"* — **bình thường**, cứ chờ vài phút.

**Nếu thấy báo "Đã chờ 5 phút — máy quét có thể đang tắt"**: máy quét chưa bật. Báo người quản lý.

Ngoài ra dữ liệu cũng **tự làm mới hai tiếng một lần**, không cần ai bấm.


## Ba cột

| 🟢 **Còn hàng** | 🔴 **Hết hàng** | 🔵 **Sản phẩm mới** |
|---|---|---|
| Có trong danh sách, vẫn còn bán | Có trong danh sách, đã hết | Chưa có trong danh sách, đang bán |
| Không phải làm gì | **Đi gỡ tin đang bán** | Có thể đăng bán thêm |

**"Danh sách" là gì?** Là toàn bộ hàng đang còn ở **lần quét ngay trước**. Mỗi lần quét nó tự cập nhật thành hàng còn của lần vừa quét.

> ⚠️ **Món đỏ chỉ hiện đúng một lần.** Nếu lần này có 4 món sang đỏ mà bạn chưa kịp gỡ tin, lần quét sau chúng sẽ không còn ở cột đỏ nữa — vì so với lần quét gần nhất thì chúng đã hết sẵn rồi. **Thấy đỏ là xử lý ngay.**

Món đã hết từ trước và giờ vẫn hết thì **không hiện ở đâu cả** — không có gì để làm với chúng.

Mỗi dòng là **một màu, một size riêng**. Supreme coi mỗi màu là một sản phẩm khác nhau, nên `Box Logo — Black — M` và `Box Logo — White — M` là hai dòng khác nhau.

- Bấm vào tên → sang thẳng trang Supreme
- Bấm **Copy** → chép tên món để dán đi chỗ khác

**Nếu không có món đỏ và không có món xanh dương**, cột đỏ chỉ hiện một dòng *"Lần quét gần nhất: không có thay đổi nào."*

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

Mỗi lần quét tự động mà tìm thấy thay đổi, bot nhắn vào channel Discord. Không có thay đổi thì không có tin.

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



## Mấy điều hay hỏi

**Bấm nút hai lần cùng lúc thì sao?**
Không sao. Nó báo "Đã có một lần quét đang chạy" và bỏ qua lần bấm thứ hai.

**Hai người cùng mở link được không?**
Được, cùng nhìn một dữ liệu.

**Có món ghi "chưa kiểm tra được" thì sao?**
Lúc quét bị lỗi mạng với riêng món đó. Nó **không** bị xếp vào hết hàng — vì chưa ai xác nhận điều đó. Quét lại lần sau thường là hết.

**Giờ hiển thị là giờ nào?**
Giờ Nhật (GMT+9), ghi rõ trên đầu trang.

**Đừng chia link cho người khác.** Ai có link và mật khẩu là xem được tất cả.

---

## Khi thấy lạ

| Hiện tượng | Làm gì |
|---|---|
| Trang quay mãi lúc mới mở | Đợi 1 phút, máy chủ đang khởi động lại |
| Hỏi mật khẩu lại | Gõ lại, trình duyệt quên sau khi đóng |
| Số liệu cũ hơn 3 tiếng | Máy quét có thể đang tắt — báo người quản lý |
| Vòng tròn xoay quá 5 phút | Tải lại trang; vẫn vậy thì báo người quản lý |
| Số liệu y hệt lần trước | Đúng rồi — không có gì đổi thật |
