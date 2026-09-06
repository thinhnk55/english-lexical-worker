# Reading API v2

Base URL: `https://english-lexical-api.hocnhe.com/v1`.

JWT do SSO phát hành. Worker chỉ dùng `sub` làm learner ID và không lưu bảng users. Mọi response dùng cùng envelope `{ success, code, messageCode, message, data?, pagination? }`.

## Nguyên tắc dữ liệu

- Luồng biên soạn: `passage -> paragraph -> sentence -> sentence_lexical -> lexical`.
- Title là một sentence riêng của passage.
- Một lexical ID có thể xuất hiện nhiều lần trong một passage. Cùng text/type vẫn có thể có nhiều lexical ID nếu nghĩa theo ngữ cảnh khác nhau.
- `token_indexes` là mảng chỉ số nguyên, không rỗng, nằm trong `sentence.tokens`. Các mapping được phép chồng lấp, ví dụ `car` dùng `[4]` và `a blue car` dùng `[2,3,4]`.
- Mọi thay đổi nguồn biên soạn đều xóa snapshot runtime. Admin chủ động publish lại; API không kiểm tra passage đã “đủ” nội dung hay chưa.
- Root `/sentences` và `/lexicals` chỉ phục vụ kiểm tra/tìm kiếm. Việc tạo mới luôn bắt đầu trong passage.

## Admin authoring

Các endpoint `/v1/admin/**` yêu cầu role `admin` hoặc `super_admin`.

### Tạo draft/import theo lô

- `POST /admin/passages/import/preview?strategy=create|upsert`
- `POST /admin/passages/import?strategy=create|upsert`

Preview không ghi DB và trả `normalized_payload` với toàn bộ ID đã sinh. FE nên commit chính payload này. Có thể gửi `{ "content": "..." }`; backend coi dòng đầu là title, dòng trống phân paragraph và dấu câu phân sentence.

Payload cấu trúc đầy đủ:

```json
{
  "passage": {
    "id": "optional-on-first-preview",
    "title": {
      "id": "optional",
      "text": "The Little Seed",
      "tokens": ["The", "Little", "Seed"],
      "translations": { "vi": "Hạt giống nhỏ" },
      "audio": null,
      "image": null,
      "lexicals": []
    },
    "summary": "A seed learns to grow.",
    "difficulty": 120,
    "reward_points": 10,
    "image": null,
    "terms": [{ "taxonomy_code": "cefr", "code": "a1" }],
    "activities": [
      { "code": "read_aloud", "name": "Read aloud", "position": 0, "config": {} }
    ],
    "paragraphs": [{
      "position": 0,
      "image": null,
      "sentences": [{
        "text": "The seed waits.",
        "tokens": ["The", "seed", "waits", "."],
        "lexicals": [{
          "id": "optional-lexical-id",
          "mapping_id": "optional-mapping-id",
          "text": "seed",
          "type": "vocabulary",
          "translations": { "vi": "hạt giống" },
          "position": 0,
          "token_indexes": [1]
        }]
      }]
    }],
    "replace_paragraphs": true,
    "replace_activities": true
  }
}
```

`replace_paragraphs` và `replace_activities` mặc định là `true`. Đặt `false` khi cố ý nhập bổ sung một phần. Import không bao giờ tự gộp lexical theo text. Muốn reuse, JSON phải dùng lại cùng lexical ID; cùng ID phải có dữ liệu lexical giống nhau ở mọi mapping.

Giới hạn một import: 1.5 MB, 50 paragraphs, 300 body sentences, 2.000 lexical mappings và tối đa 1.000 D1 statements ước tính.

### Hiệu chỉnh passage

- `GET /admin/passages`, `GET|PUT|DELETE /admin/passages/:id`
- `GET|POST /admin/passages/:id/paragraphs`
- `GET|PUT|DELETE /admin/paragraphs/:id`
- `POST /admin/passages/:passageId/paragraphs/:paragraphId/sentences` tạo sentence mới trong đúng passage.
- `GET|PUT|DELETE /admin/sentences/:id`; khi rút ngắn tokens làm mapping cũ vượt phạm vi, API trả `TOKEN_MAPPINGS_OUT_OF_RANGE`. Gửi `drop_invalid_mappings: true` để xóa các mapping đó cùng transaction.
- `PUT|DELETE /admin/paragraph-sentences/:id` chỉ reorder hoặc xóa sentence khỏi paragraph.
- `GET /admin/lexicals`, `GET|PUT|DELETE /admin/lexicals/:id` để kiểm tra/hiệu chỉnh lexical đã thuộc passage.

### Lexical theo ngữ cảnh

- `GET /admin/passages/:passageId/lexical-candidates?text=car&type=vocabulary` trả lexical trùng trong passage và mọi sentence context.
- `POST /admin/passages/:passageId/sentences/:sentenceId/lexicals` tạo lexical mới và mapping trong một D1 batch.
- `POST /admin/passages/:passageId/sentences/:sentenceId/lexical-mappings` reuse một lexical đã thuộc passage.
- `GET /admin/sentences/:sentenceId/lexicals`
- `PUT|DELETE /admin/sentence-lexicals/:mappingId`

Khi tạo lexical mới mà passage đã có candidate cùng text/type, API trả `409` với `reason: LEXICAL_CANDIDATES_EXIST`. Admin chọn endpoint reuse hoặc gửi lại `allow_duplicate: true` để xác nhận nghĩa ngữ cảnh mới.

### Media assets

Assets nằm trong R2 bucket `english-lexical-assets` và dùng ID dữ liệu làm canonical key:

- `passages/:id/image.avif`, `paragraphs/:id/image.avif`
- `sentences/:id/audio.opus`, `sentences/:id/image.avif`
- `lexicals/:id/audio.opus`, `lexicals/:id/image.avif`

Upload hoặc thay thế bằng `PUT /admin/media/:entity/:id/:kind` với raw body và đúng `Content-Type` (`audio/opus` hoặc `image/avif`). Xóa riêng asset bằng `DELETE` cùng URL. API lưu public URL có `?v=<uuid>` trực tiếp vào field `audio`/`image`; không có field version riêng và không tạo object version mới. Public asset đọc qua `GET|HEAD /assets/:canonicalKey`.

Các API xóa passage, paragraph, sentence hoặc lexical luôn chờ xóa canonical objects trên R2 trước rồi mới xóa dữ liệu D1. Nếu R2 lỗi, dữ liệu D1 được giữ nguyên để admin retry.

### Taxonomy, activity, roadmap và runtime

- Taxonomy: CRUD `/admin/taxonomies`, `/admin/taxonomies/:id/terms`, `/admin/taxonomy-terms/:id`.
- Gán passage: `GET|PUT /admin/passages/:id/terms`. API kiểm tra taxonomy `single` như CEFR chỉ có một term.
- Activity: `GET|POST /admin/passages/:id/activities`, `GET|PUT|DELETE /admin/activities/:id`. `code` và `position` là duy nhất trong passage; `config` để mở cho FE định nghĩa nhiệm vụ.
- Fixed roadmap: CRUD `/admin/roadmaps`, `/admin/roadmaps/:id/passages`, `/admin/roadmap-passages/:id`; lifecycle dùng `POST /admin/roadmaps/:id/publish|unpublish|archive|unarchive`.
- Runtime: `GET|PUT|DELETE /admin/passages/:id/runtime`; PUT hydrate source graph thành snapshot, DELETE unpublish.

## Learner APIs

- Library runtime: `GET /passages`, `GET /passages/:id`. List hỗ trợ `text`, `difficulty_min`, `difficulty_max` và nhiều `term_id`.
- Taxonomy hiển thị đa ngôn ngữ: `GET /taxonomies`, `GET /taxonomies/:id`.
- Fixed roadmap: `GET /roadmaps`, `GET /roadmaps/:id`.
- Một bài active: `GET|POST|DELETE /me/reading/active`. POST nhận `mode: flexible` hoặc `mode: fixed` cùng `roadmap_passage_id`. DELETE bỏ bài chưa hoàn thành và xóa luôn tiến độ của lần đó.
- Kết quả nhiệm vụ: `PUT /me/reading/active/activities/:activityId`. Backend chỉ lưu trạng thái cuối, score/result/audio; FE quyết định điều kiện hoàn thành.
- Xác nhận hoàn thành và nhận thưởng duy nhất: `POST /me/reading/active/complete`. Update có điều kiện và trigger thưởng liên bảng chạy nguyên tử, nên retry không cộng điểm lần hai.
- Lịch sử: `GET /me/reading/history`, `GET /me/reading/history/:readingId`.
- Thống kê thực chất: `GET /me/reading/summary`.
- Điểm/streak: `GET /me/profile`, `POST /me/reading/check-in`. Ngày được tính theo UTC+7; chỉ lưu streak hiện tại, dài nhất và ngày check-in cuối, không có bảng lịch sử điểm danh.
- Lexical tự chọn: `GET|POST /me/lexicals`, `DELETE /me/lexicals/:lexicalId`.
- Chọn lexical đáng review nhất: `GET /me/lexicals/review?limit=20` (tối đa 50), ưu tiên chưa đánh giá, điểm thấp rồi lâu chưa review.
- Ghi kết quả review theo lô: `PUT /me/lexicals/review`. FE gửi `meaning_score`, `pronunciation_score`, `review_score`; BE chỉ xác thực và lưu.

Backend không tự quyết định bài kế tiếp, điều kiện hoàn thành activity hay công thức chấm lexical. Các ràng buộc BE giữ là ownership, một bài active, một lần thưởng, fixed/flexible mode và tính toàn vẹn của mapping nội dung.
