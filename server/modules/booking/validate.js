import { z } from 'zod';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';



dayjs.extend(customParseFormat);


const createBookingSchema = z
.object({
  room_id: z.coerce.number().int().positive('无效的 room_id'),
  start_time: z.any().refine(v => dayjs(v, 'YYYY-MM-DDTHH:mm:ss[Z]').isValid(), '无效的 start_time, 必须是 YYYY-MM-DDTHH:mm:ssZ 格式'),
  end_time: z.any().refine(v => dayjs(v, 'YYYY-MM-DDTHH:mm:ss[Z]').isValid(), '无效的 end_time, 必须是 YYYY-MM-DDTHH:mm:ssZ 格式')
})
.refine(data => dayjs(data.start_time).isBefore(dayjs(data.end_time)), '吗的,开始时间必须小于结束时间');


export { createBookingSchema }
