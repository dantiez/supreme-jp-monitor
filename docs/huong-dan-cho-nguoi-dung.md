# Bot canh hàng Supreme Nhật — hướng dẫn dùng

*Gửi cho người dùng. Không cần biết gì về kỹ thuật.*

---

## Nó làm gì cho bạn

Có một con bot đang **canh trang Supreme Nhật (jp.supreme.com) giùm bạn, 24/7**.

Cứ 2 tiếng nó vào xem một lượt toàn bộ sản phẩm. Thấy có gì đổi thì nhắn vào Discord.

Bạn **không phải làm gì cả** — không cài, không mở web, không canh. Chỉ cần ở trong channel Discord là tin tự tới.

---

## 5 loại tin bạn sẽ nhận

### 🟢 Back in stock — **quan trọng nhất**

> **Back in stock: Lynx Faux Fur WINDSTOPPER Overcoat**
> Tan | Size Medium | ¥132,000

Món này **trước đã hết, giờ có lại**. Đây là lý do con bot tồn tại.

👉 **Bấm vào tên món là sang thẳng trang mua.** Hàng Supreme về lại thường bay rất nhanh — thấy tin này thì bấm luôn, đừng để lát nữa.

### 🔵 New product — hàng mới lên sàn

> **New product: Captains Varsity Jacket**
> Brown

Món chưa từng có, vừa xuất hiện.

### 🟦 New size — món cũ có thêm size

Món bạn đã thấy rồi, nay Supreme thêm size mới.

### 🟡 Price changed — đổi giá

> **Price changed: Woven Suede Hooded Work Jacket**
> Black | Size Large | ¥129,000 → ¥132,000

Giá cũ → giá mới.

### ⚪ Sold out — vừa hết hàng

Đọc cho biết thôi. Đến lúc bạn thấy tin này thì món đã hết rồi, không làm gì được nữa.

---

## Cách đọc một tin

**Dòng đầu tiên là tổng kết:**

> New product: 30 (showing 10, 20 more)

Nghĩa là: có **30** món mới, Discord hiện **10** ô, còn **20** món nữa không hiện hết.

Discord chỉ cho hiện tối đa 10 ô trong một tin. Bot **nói rõ còn bao nhiêu** thay vì lặng lẽ giấu đi — để bạn biết là còn nữa.

**Mỗi ô bên dưới là một món:**

```
New product: AOI GORE-TEX Hooded Jacket     ← tên món, BẤM ĐƯỢC
Orange | Size Large | ¥85,800               ← màu | size | giá
```

---

## Một điều dễ hiểu nhầm

Bạn sẽ thấy **cùng một tên món xuất hiện nhiều lần**, ví dụ:

> New product: Lynx Faux Fur WINDSTOPPER Overcoat — **Tan**
> New product: Lynx Faux Fur WINDSTOPPER Overcoat — **Black**

**Đây không phải lỗi lặp tin.**

Supreme coi **mỗi màu là một sản phẩm riêng biệt**, có trang riêng, giá riêng, tình trạng hàng riêng. Áo Tan hết hàng không có nghĩa áo Black hết. Nên bot cũng theo dõi riêng từng màu — đúng như cách Supreme làm.

---

## Nó KHÔNG làm được gì

Nói trước để bạn khỏi trông đợi nhầm:

| | |
|---|---|
| ❌ **Không mua hộ** | Bot chỉ báo tin. Bấm link rồi bạn tự mua |
| ❌ **Không giữ hàng** | Không đặt trước, không giữ chỗ |
| ❌ **Không báo tức thì** | Quét mỗi 2 tiếng → chậm nhất là 2 tiếng sau khi hàng về |
| ❌ **Không đảm bảo còn hàng** | Món hot có thể hết trước khi bạn kịp bấm |

Nói thẳng: với hàng cực hot, 2 tiếng là quá chậm. Bot này hợp để **không bỏ lỡ** những món về lại lặng lẽ mà không ai để ý — chứ không phải để tranh hàng limited với dân dùng bot mua tự động.

---

## Không thấy tin gì nghĩa là sao?

**Nghĩa là không có gì thay đổi.** Bình thường.

Bot chỉ nhắn khi **thật sự có chuyện**. Nó **cố tình không** nhắn "hôm nay không có gì mới" mỗi 2 tiếng — vì nhắn kiểu đó vài ngày là bạn sẽ quen tay lướt qua, rồi tin quan trọng thật cũng bị lướt luôn.

Im lặng = mọi thứ vẫn thế.

Supreme thường **drop hàng vào thứ Năm**, nên hôm đó sẽ nhộn nhịp hẳn, các ngày khác im hơn.

---

## Tóm gọn

1. Ở trong channel Discord, không cần làm gì thêm
2. Thấy **🟢 Back in stock** → bấm vào tên món ngay
3. Cùng tên khác màu = hai món khác nhau, không phải lặp
4. Im lặng = không có gì đổi
5. Bot báo tin, không mua hộ

---

*Có gì lạ — bot im quá lâu, hoặc báo sai — nhắn cho người quản lý bot.*
