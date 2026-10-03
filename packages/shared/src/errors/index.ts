export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}
export class ValidationError extends AppError {
  constructor(message = "Request validation failed") {
    super("VALIDATION_ERROR", message, 400);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message, 401);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, 403);
  }
}
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", message, 404);
  }
}
export class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super("CONFLICT", message, 409);
  }
}
export class UnsafeTargetError extends AppError {
  constructor(message = "Target is not allowed") {
    super("UNSAFE_TARGET", message, 422);
  }
}
export class UpstreamError extends AppError {
  constructor(code: string, message: string, statusCode = 502) {
    super(code, message, statusCode);
  }
}
