export class ToolError extends Error {
  constructor(public code: string, message: string, public retryAfterSeconds?: number) { super(message); }
}

export function safeError(error: unknown): { code: string; message: string; retry_after_seconds?: number } {
  if (error instanceof ToolError) {
    return { code: error.code, message: error.message, ...(error.retryAfterSeconds ? { retry_after_seconds: error.retryAfterSeconds } : {}) };
  }
  return { code: 'INTERNAL_ERROR', message: 'The request failed. Check the server configuration and try again.' };
}
