import fs from 'fs/promises';
import path from 'path';

const stateFile = path.resolve('/tmp/min-workflow-state.json');

const Steps = {
  EXTRACT_TASK: 'extract_task',
  VALIDATE_TASK: 'validate_task',
  RESOLVE_RESOURCE: 'resolve_resource',
  CREATE_BOOKING: 'create_booking',
  WAIT_APPROVAL: 'wait_approval',
  AFTER_APPROVAL: 'after_approval',
  DONE: 'done'
};

const Status = {
  RUNNING: 'running',
  WAITING: 'waiting',
  COMPLETED: 'completed',
  FAILED: 'failed',
  COMPENSATING: 'compensating'
};

const retryPolicy = {
  sendEmail: 2
};

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

async function saveState(state) {
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function resetState() {
  await fs.rm(stateFile, { force: true });
}

function createInitialState(overrides = {}) {
  return {
    workflowId: `wf_${Date.now()}`,
    status: Status.RUNNING,
    currentStep: Steps.EXTRACT_TASK,
    userInput: '帮我订明天下午 2 点能坐 10 人的会议室',
    task: createBookingTask(overrides),
    steps: {},
    retry: {},
    events: {},
    lastError: null
  };
}

function createBookingTask(overrides = {}) {
  return {
    understanding: {
      intent: {
        verb: 'create',
        object: 'meeting_room_booking',
        objectConstraints: {
          room: {
            capacity: { gte: 10 },
            availability: 'required'
          },
          booking: {
            status: 'pending'
          }
        }
      },
      actor: {
        who: 'current_user',
        userId: 1,
        target: 'own_resource',
        permission: 'authenticated'
      },
      time: {
        executionTime: 'now',
        businessTime: {
          startTime: '2026-05-04 14:00:00',
          endTime: '2026-05-04 15:00:00',
          timezone: 'Asia/Shanghai'
        },
        waitPolicy: 'wait_for_admin_if_required'
      },
      location: {
        system: 'booking_system',
        resourceLocator: {
          roomId: null,
          bookingId: null
        },
        environment: 'demo'
      }
    },
    risk: {
      operationType: 'write',
      impactScope: 'own_booking',
      requiresConfirmation: false,
      rollbackAvailable: true
    },
    execution: {
      toolPlan: [
        'extractTask',
        'validateTask',
        'searchRooms',
        'checkAvailability',
        'createBookingForCurrentUser',
        'waitForAdminIfRequired',
        'sendEmail',
        'writeAuditLog'
      ],
      workflowPolicy: [
        'sequential',
        'wait_for_admin_if_required',
        'retry_notification',
        'compensate_booking_on_failure'
      ],
      output: 'booking_result'
    },
    runtime: {
      forceFatalAfterBooking: false,
      ...overrides
    }
  };
}

function getIntent(state) {
  return state.task.understanding.intent;
}

function getActor(state) {
  return state.task.understanding.actor;
}

function getTime(state) {
  return state.task.understanding.time;
}

function getLocator(state) {
  return state.task.understanding.location.resourceLocator;
}

function mergeTaskResult(state, result) {
  if (result.roomId) {
    getLocator(state).roomId = result.roomId;
  }

  if (result.bookingId) {
    getLocator(state).bookingId = result.bookingId;
  }

  if (result.bookingStatus) {
    getIntent(state).objectConstraints.booking.status = result.bookingStatus;
  }

  state.task.runtime = {
    ...state.task.runtime,
    ...result
  };
}

async function runStep(state, name, task, options = {}) {
  if (state.steps[name]?.status === 'success') {
    console.log(`[skip] ${name} already completed`);
    return state.steps[name].output;
  }

  state.steps[name] = {
    status: 'running',
    input: state.task,
    startedAt: new Date().toISOString()
  };
  await saveState(state);

  try {
    const output = await task(state);
    mergeTaskResult(state, output);
    state.steps[name] = {
      ...state.steps[name],
      status: 'success',
      output,
      finishedAt: new Date().toISOString()
    };
    await saveState(state);
    return output;
  } catch (e) {
    state.retry[name] = (state.retry[name] || 0) + 1;
    state.steps[name] = {
      ...state.steps[name],
      status: 'failed',
      error: e.message,
      failedAt: new Date().toISOString()
    };
    state.lastError = e.message;
    await saveState(state);

    if (state.retry[name] <= (options.retries || 0)) {
      console.log(`[retry] ${name}, attempt ${state.retry[name]}`);
      return runStep(state, name, task, options);
    }

    if (options.fallback) {
      console.log(`[fallback] ${name}`);
      return options.fallback(state);
    }

    throw e;
  }
}

async function extractTask(state) {
  const { verb, object } = getIntent(state);
  if (!verb || !object) {
    return {
      needsClarification: true,
      clarificationQuestion: '你想执行什么动作，操作哪个对象？'
    };
  }

  return {
    extracted: true,
    verb,
    object
  };
}

async function validateTask(state) {
  const { verb, object } = getIntent(state);
  const actor = getActor(state);
  const time = getTime(state);

  if (!verb || !object) {
    throw new Error('missing verb or object');
  }

  if (!actor.userId || actor.permission !== 'authenticated') {
    throw new Error('permission denied');
  }

  if (!time.businessTime.startTime || !time.businessTime.endTime) {
    return {
      needsClarification: true,
      clarificationQuestion: '你想预约几点到几点？'
    };
  }

  return { validated: true };
}

async function resolveResource(state) {
  const locator = getLocator(state);
  if (locator.roomId) {
    return { roomId: locator.roomId };
  }

  const constraints = getIntent(state).objectConstraints.room;
  console.log(`[tool] searchRooms capacity >= ${constraints.capacity.gte}`);
  console.log('[tool] checkAvailability');
  return { roomId: 2, roomName: 'A-301' };
}

async function createBooking(state) {
  const actor = getActor(state);
  const time = getTime(state);
  const locator = getLocator(state);

  console.log('[side effect] insert booking');
  return {
    bookingId: 123,
    userId: actor.userId,
    roomId: locator.roomId,
    startTime: time.businessTime.startTime,
    endTime: time.businessTime.endTime,
    bookingStatus: state.task.understanding.time.waitPolicy === 'wait_for_admin_if_required'
      ? 'pending'
      : 'approved'
  };
}

async function waitApproval(state) {
  if (!state.events.approved) {
    state.status = Status.WAITING;
    state.currentStep = Steps.WAIT_APPROVAL;
    await saveState(state);
    console.log('[waiting] admin approval required');
    return { waitingFor: 'admin_approval' };
  }

  return {
    waitingFor: null,
    bookingStatus: 'approved',
    approvedAt: new Date().toISOString()
  };
}

async function sendEmail(state) {
  if ((state.retry.sendEmail || 0) < 1) {
    throw new Error('email provider temporary failure');
  }
  console.log('[parallel] email sent');
  return { emailSent: true };
}

async function writeAuditLog() {
  console.log('[parallel] audit log written');
  return { auditLogged: true };
}

async function enqueueEmailRetry(state) {
  state.task.runtime.emailRetryQueued = true;
  await saveState(state);
  return { emailRetryQueued: true };
}

async function compensateBooking(state) {
  state.status = Status.COMPENSATING;
  await saveState(state);

  if (getLocator(state).bookingId) {
    console.log('[compensate] cancel booking because workflow failed');
    mergeTaskResult(state, { bookingStatus: 'cancelled' });
    state.steps.compensate_booking = {
      status: 'success',
      output: { bookingStatus: 'cancelled' },
      finishedAt: new Date().toISOString()
    };
  }

  state.status = Status.FAILED;
  await saveState(state);
}

async function runWorkflow() {
  const state = await loadState() || createInitialState();

  try {
    if (state.currentStep === Steps.EXTRACT_TASK) {
      await runStep(state, Steps.EXTRACT_TASK, extractTask);
      state.currentStep = Steps.VALIDATE_TASK;
      await saveState(state);
    }

    if (state.currentStep === Steps.VALIDATE_TASK) {
      await runStep(state, Steps.VALIDATE_TASK, validateTask);
      state.currentStep = Steps.RESOLVE_RESOURCE;
      await saveState(state);
    }

    if (state.currentStep === Steps.RESOLVE_RESOURCE) {
      await runStep(state, Steps.RESOLVE_RESOURCE, resolveResource);
      state.currentStep = Steps.CREATE_BOOKING;
      await saveState(state);
    }

    if (state.currentStep === Steps.CREATE_BOOKING) {
      await runStep(state, Steps.CREATE_BOOKING, createBooking);
      if (state.task.runtime.forceFatalAfterBooking) {
        throw new Error('fatal error after booking created');
      }
      state.currentStep = state.task.runtime.bookingStatus === 'pending'
        ? Steps.WAIT_APPROVAL
        : Steps.AFTER_APPROVAL;
      await saveState(state);
    }

    if (state.currentStep === Steps.WAIT_APPROVAL) {
      await runStep(state, Steps.WAIT_APPROVAL, waitApproval);
      if (!state.events.approved) return;
      state.status = Status.RUNNING;
      state.currentStep = Steps.AFTER_APPROVAL;
      await saveState(state);
    }

    if (state.currentStep === Steps.AFTER_APPROVAL) {
      const [emailResult, auditResult] = await Promise.all([
        runStep(state, 'sendEmail', sendEmail, {
          retries: retryPolicy.sendEmail,
          fallback: enqueueEmailRetry
        }),
        runStep(state, 'writeAuditLog', writeAuditLog)
      ]);

      mergeTaskResult(state, { ...emailResult, ...auditResult });
      state.status = Status.COMPLETED;
      state.currentStep = Steps.DONE;
      await saveState(state);
    }

    console.log('[completed]', state.task);
  } catch (e) {
    console.log('[failed]', e.message);
    await compensateBooking(state);
  }
}

async function approveWorkflow() {
  const state = await loadState();
  if (!state) {
    console.log('no workflow state found');
    return;
  }

  const approvedAt = new Date().toISOString();
  state.events.approved = true;
  state.status = Status.RUNNING;
  mergeTaskResult(state, {
    waitingFor: null,
    bookingStatus: 'approved',
    approvedAt
  });
  state.steps[Steps.WAIT_APPROVAL] = {
    ...(state.steps[Steps.WAIT_APPROVAL] || {}),
    status: 'success',
    output: {
      waitingFor: null,
      bookingStatus: 'approved',
      approvedAt
    },
    finishedAt: new Date().toISOString()
  };
  await saveState(state);
  console.log('[event] approved');
}

const command = process.argv[2] || 'run';

if (command === 'reset') {
  await resetState();
  console.log('state reset');
} else if (command === 'approve') {
  await approveWorkflow();
} else if (command === 'fail-after-booking') {
  await resetState();
  await saveState(createInitialState({ forceFatalAfterBooking: true }));
  await runWorkflow();
} else {
  await runWorkflow();
}
