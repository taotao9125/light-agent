import AppError from '../errors/appError.js';
import { errorEvents } from '../consts/logEvents.js';

export default function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError('参数错误', 400, {
      code: errorEvents.VALIDATION_ERROR,
      details: result.error.issues.map(e => ({
        field: e.path.join('.'),
        message: e.message
      }))
    });
  }
  return result.data;
}
