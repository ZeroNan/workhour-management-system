// ApiError 类与错误码常量（与前端 api.js 共享语义）
export const ERR = {
  UNAUTHORIZED: { status: 401, code: 'UNAUTHORIZED' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN' },
  SELF_AUDIT_FORBIDDEN: { status: 403, code: 'SELF_AUDIT_FORBIDDEN' },
  NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  STATE_CONFLICT: { status: 409, code: 'STATE_CONFLICT' },
  REFERENCED: { status: 409, code: 'REFERENCED' },
  DAY_NOT_EDITABLE: { status: 409, code: 'DAY_NOT_EDITABLE' },
  VALIDATION_ERROR: { status: 400, code: 'VALIDATION_ERROR' },
  FUTURE_DATE: { status: 400, code: 'FUTURE_DATE' },
  HOURS_EXCEEDED: { status: 400, code: 'HOURS_EXCEEDED' },
  NOT_MEMBER: { status: 403, code: 'NOT_MEMBER' },
  DUPLICATE_NAME: { status: 400, code: 'DUPLICATE_NAME' },
  DUPLICATE_USERNAME: { status: 400, code: 'DUPLICATE_USERNAME' },
  WEAK_PASSWORD: { status: 400, code: 'WEAK_PASSWORD' },
  WRONG_OLD_PASSWORD: { status: 400, code: 'WRONG_OLD_PASSWORD' },
  COMMENT_REQUIRED: { status: 400, code: 'COMMENT_REQUIRED' },
  INVALID_CREDENTIALS: { status: 401, code: 'INVALID_CREDENTIALS' },
  ACCOUNT_LOCKED: { status: 423, code: 'ACCOUNT_LOCKED' },
  // ---- WPS / 开放集成接口专用 ----
  API_KEY_MISSING: { status: 401, code: 'API_KEY_MISSING' },
  API_KEY_INVALID: { status: 401, code: 'API_KEY_INVALID' },
  API_KEY_DISABLED: { status: 403, code: 'API_KEY_DISABLED' },
  RATE_LIMITED: { status: 429, code: 'RATE_LIMITED' },
  IDEMPOTENCY_CONFLICT: { status: 409, code: 'IDEMPOTENCY_CONFLICT' },
  EMPLOYEE_NOT_FOUND: { status: 422, code: 'EMPLOYEE_NOT_FOUND' },
  PROJECT_NOT_FOUND: { status: 422, code: 'PROJECT_NOT_FOUND' },
  INVALID_RECORD: { status: 422, code: 'INVALID_RECORD' },
  PAYLOAD_TOO_LARGE: { status: 413, code: 'PAYLOAD_TOO_LARGE' },
  INTERNAL: { status: 500, code: 'INTERNAL' },
};

export class ApiError extends Error {
  constructor(def, message, details) {
    super(message || def.code);
    this.status = def.status;
    this.code = def.code;
    this.details = details;
  }
}

export const err = (name, message, details) => new ApiError(ERR[name], message, details);

/**
 * async 路由包装器：Express 4 不会自动捕获 async handler 抛出的 rejection，
 * 统一用 wrap() 包一层，把 Promise rejection 转给 errorHandler。
 * 用法：router.get('/x', wrap(async (req, res) => { ... }))
 */
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
