import {z} from 'zod';
import AppError from '../../errors/appError.js';

const schema = z.object({
  username: z.email('邮箱格式不正确'),
  password: z
    .string()
    .min(3, '密码不能为空')
    .regex(/[A-Za-z]/, '密码必须包含字母')
    .regex(/[0-9]/, '密码必须包含数字')
})


export default function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(result.error.issues[0].message);
  }
  return result.data;
}

export {schema}