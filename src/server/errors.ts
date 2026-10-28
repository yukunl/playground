import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiError, ApiErrorBody } from '../shared/api-error'
import type { AppEnv } from './env'

/** Answers with our error shape, stamped with this request's ID. */
export function errorJson(c: Context<AppEnv>, httpStatus: number, error: Omit<ApiError, 'requestId'>) {
  return c.json<ApiErrorBody>({ error: { ...error, requestId: c.get('requestId') } }, httpStatus as ContentfulStatusCode)
}
