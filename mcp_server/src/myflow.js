import fs from 'node:fs/promises';
import path from 'path';


const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImxsQHFxLmNvbSIsInVpZCI6MTcsInJvbGUiOm51bGwsImlhdCI6MTc3ODA1NDcwMiwiZXhwIjoxNzc4MTQxMTAyfQ.95vM-bmHL7Oal6rlyRKUhQxANDgE0d9f9KsljbPtgq4';

async function request(method, url, params = {}, token = TOKEN) {
  const upperMethod = method.toUpperCase();

  const headers = {
    Authorization: `Bearer ${token}`
  };

  const options = {
    method: upperMethod,
    headers
  };

  let finalUrl = url;

  if (upperMethod === 'GET' || upperMethod === 'DELETE') {
    const query = new URLSearchParams(params).toString();
    if (query) {
      finalUrl += url.includes('?') ? `&${query}` : `?${query}`;
    }
  } else {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(params);
  }

  const res = await fetch(finalUrl, options);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}






const JOB_STATUS = {
  PENDING: 'pending',
  RUNING: 'runing',
  SUCCESS: 'success',
  FAILED: 'failed'
}


function* bookingWorkFlow() {
  yield {
    name: 'booking',
    run: async (...args) => {
      return request(...args);
    }
  }

}

async function run(bookingWorkFlow, ctx = {}) {
  const iterator = bookingWorkFlow();

  const results = {
    steps: [],
    result: {},
    error: null,
    currentStatus: JOB_STATUS.PENDING,
    ctx
  };
  while (true) {
    const { value, done } = iterator.next();
    if (done) {
      results.currentStatus = JOB_STATUS.SUCCESS;
      results.steps.push({
        status: JOB_STATUS.SUCCESS,
        name: 'all done'
      })
      break;
    }


    results.currentStatus = JOB_STATUS.PENDING;
    results.steps.push({
      status: JOB_STATUS.PENDING,
      name: value.name
    })

    try {

      results.currentStatus = JOB_STATUS.RUNING;
      results.steps.push({
        status: JOB_STATUS.RUNING,
        name: value.name
      })



      const ret = await value.run('get', 'http://localhost:3000/api/booking', {
        "start_time": 1779085800000,
        "end_time": 1779089400000,
        "room_id": 1
      })

      results.result = ret;


    } catch (e) {
      results.currentStatus = JOB_STATUS.FAILED;
      results.steps.push({
        status: JOB_STATUS.FAILED,
        name: value.name
      })
      results.error = e instanceof Error ? e.message : String(e);
      break;
    }


  }

  return results;
}



const s = await run(bookingWorkFlow, {});

console.log(s)