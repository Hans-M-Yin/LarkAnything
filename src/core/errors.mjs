export class LarkAnythingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LarkAnythingError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message) {
  if (!condition) throw new LarkAnythingError(code, message);
}
