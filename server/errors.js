export class HttpError extends Error {
  constructor(status, message, code = 'request_failed', details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) =>
  new HttpError(400, message, 'bad_request', details);

export const notFound = (message = 'Not found') =>
  new HttpError(404, message, 'not_found');

export const forbidden = (message = 'Forbidden') =>
  new HttpError(403, message, 'forbidden');

export const unsupported = (message) =>
  new HttpError(415, message, 'unsupported_file');

export function errorBody(error) {
  return {
    error: {
      code: error.code || 'request_failed',
      message: error.message || 'Something went wrong.',
      ...(error.details ? { details: error.details } : {})
    }
  };
}
