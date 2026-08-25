const messages: Record<string, string> = {
  SUCCESS: 'Thành công.',
  CREATED: 'Đã tạo thành công.',
  UPDATED: 'Đã cập nhật thành công.',
  DELETED: 'Đã xóa thành công.',
  BAD_REQUEST: 'Yêu cầu không hợp lệ, vui lòng kiểm tra lại.',
  INTERNAL_ERROR: 'Hệ thống đang gặp sự cố, vui lòng thử lại sau.',
  VALIDATION_ERROR: 'Thông tin cung cấp không hợp lệ.',
  UNAUTHORIZED: 'Vui lòng đăng nhập để thực hiện thao tác này.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy nội dung bạn yêu cầu.',
  CONFLICT: 'Thông tin này đã tồn tại trong hệ thống.',
};

export function getMessage(code: string): string {
  return messages[code] ?? 'Đã có lỗi xảy ra.';
}
