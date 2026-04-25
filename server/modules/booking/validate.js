import { z } from 'zod';
import dayjs from 'dayjs';
import AppError from '../../errors/appError.js';





const createBookingSchema = z
.object({
  room_id: z.coerce.number().int().positive('无效的 room_id'),
  start_time: z.any().refine(v => dayjs(v).isValid(), '无效的 start_time'),
  end_time: z.any().refine(v => dayjs(v).isValid(), '无效的 end_time')
})
.refine(data => dayjs(data.start_time).isBefore(dayjs(data.end_time)), '吗的,开始时间必须小于结束时间');


export default function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(result.error.issues[0].message);
  }
  return result.data;
}

export { createBookingSchema }