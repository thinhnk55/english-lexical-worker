# Reading API

Tất cả endpoint JSON đều nằm dưới `/v1`. JWT SSO cung cấp `sub`; Worker không tạo bảng users.

## Nhóm admin: biên soạn và quản trị

Các endpoint `/v1/admin/**` bắt buộc role `admin` hoặc `super_admin`.

- Nội dung: `/lexicals`, `/sentences`, `/sentence-lexicals`, `/passages`, `/paragraphs`, `/paragraph-sentences`.
- Phân loại: `/taxonomies`, `/taxonomy-terms`, `/passages/:id/terms`.
- Nhiệm vụ: `/passages/:id/activities`, `/activities/:id`.
- Roadmap cố định: `/roadmaps`, `/roadmaps/:id/passages`, `/roadmap-passages/:id`.
- Publish runtime: `PUT` hoặc `DELETE /passages/:id/runtime`.
- Nhập passage từ JSON do AI sinh: `POST /passages/import/preview` để kiểm tra trước, sau đó `POST /passages/import` để ghi transaction. Dùng `?strategy=upsert` (mặc định) khi chỉnh sửa dần; dùng `?strategy=create` cho bài mới.
- Roadmap lifecycle: `POST /roadmaps/:id/publish`, `/unpublish`, `/archive`, `/unarchive`.

Admin chủ động quyết định thời điểm publish runtime. API không tự kiểm tra “đã đủ nội dung để publish” và không tự áp đặt thứ tự nhiệm vụ.

### JSON import passage-first

Admin/FE chỉ cần gửi một object `passage` gồm `title`, `paragraphs[].sentences[].lexicals[]`, cùng metadata/terms/activities. `id` là tùy chọn ở lần đầu; endpoint preview trả `normalized_payload` đã tự sinh ID để FE lưu lại và dùng cho các lần upsert tiếp theo.

```json
{
  "passage": {
    "title": { "text": "The Little Seed", "lexicals": [] },
    "summary": "A seed learns to grow.",
    "difficulty": 120,
    "reward_points": 10,
    "terms": [{ "taxonomy_code": "cefr", "code": "a1" }],
    "activities": [{ "code": "read", "name": "Read aloud", "config": {} }],
    "paragraphs": [{
      "sentences": [{
        "text": "The seed waits.",
        "lexicals": [{ "text": "seed", "type": "vocabulary", "translations": { "vi": "hạt giống" } }]
      }]
    }]
  }
}
```

Nếu sentence không có `tokens`, backend tự tách theo khoảng trắng và trả warning để admin hiệu chỉnh bằng AI/FE. Import sẽ xóa runtime snapshot cũ; admin phải publish lại sau khi duyệt nội dung.

## Nhóm người dùng: đọc, tiến độ và ôn tập

Các endpoint `/v1/**` yêu cầu đăng nhập, nhưng không yêu cầu role admin.

- Thư viện: `GET /passages`, `GET /passages/:id`, `GET /taxonomies`, `GET /taxonomies/:id`, `GET /roadmaps`, `GET /roadmaps/:id`.
- Một phiên đọc: `GET/POST/DELETE /me/reading/active`.
- Tiến độ activity: `PUT /me/reading/active/activities/:activityId`.
- Xác nhận hoàn thành và nhận thưởng một lần: `POST /me/reading/active/complete`.
- Lịch sử ôn lại: `GET /me/reading/history`, `GET /me/reading/history/:readingId`.
- Báo cáo tối giản: `GET /me/reading/summary`.
- Profile reading (reward/streak): `GET /me/profile`.
- Điểm danh streak: `POST /me/reading/check-in`.
- Lexical tự chọn để ôn: `GET/POST /me/lexicals`, `GET/PUT /me/lexicals/review`, `DELETE /me/lexicals/:lexicalId`.

`passages_runtime` là nguồn đọc chính của người dùng. Nếu runtime đã bị admin xóa, chi tiết lịch sử của chính học viên sẽ fallback về graph biên soạn để vẫn có thể review.

Backend chỉ giữ trạng thái mới nhất của activity và lexical review. Backend không quyết định điều kiện hoàn thành, thuật toán chọn bài tiếp theo, hay điểm “hiểu/không hiểu”.
