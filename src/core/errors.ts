/** Lỗi nghiệp vụ có mã HTTP. Thay cho `QuotationError` rải rác ở bản cũ. */
export class AppError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code?: string) => new AppError(400, message, code);
export const unauthorized = (message = 'Vui lòng đăng nhập.') => new AppError(401, message);
export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này.') => new AppError(403, message);
export const notFound = (message = 'Không tìm thấy dữ liệu.') => new AppError(404, message);
export const conflict = (message: string, code?: string) => new AppError(409, message, code);
