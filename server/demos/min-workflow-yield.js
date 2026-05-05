import fs from 'fs/promises';
import path from 'path';

const stateFile = path.resolve('/tmp/min-workflow-yield-state.json');

const Status = {
  RUNNING: 'running',
  WAITING: 'waiting',
  COMPLETED: 'completed',
  FAILED: 'failed',
  COMPENSATING: 'compensating'
};

const StepOrder = [
  'validate',
  'create_booking',
  'wait_approval',
  'after_approval'
];

const tasks = {
  async validate(ctx) {
    if (!ctx.userId || !ctx.roomId) {
      throw new Error('invalid booking input');
    }
    return { validated: true };
  },

  async createBooking(ctx) {
    console.log('[side effect] insert booking');
    return {
      bookingId: 123,
      bookingStatus: ctx.needsApproval ? 'pending' : 'approved'
    };
  },

  async sendEmail(ctx, state) {
    if ((state.retry.sendEmail || 0) < 1) {
      throw new Error('email provider temporary failure');
    }
    console.log('[parallel] email sent');
    return { emailSent: true };
  },

  async writeAuditLog() {
    console.log('[parallel] audit log written');
    return { auditLogged: true };
  },

  async enqueueEmailRetry(ctx, state) {
    state.context.emailRetryQueued = true;
    await saveState(state);
    return { emailRetryQueued: true };
  }
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

function createInitialState(context = {}) {
  return {
    workflowId: `wf_${Date.now()}`,
    status: Status.RUNNING,
    currentStep: 'validate',
    context: {
      userId: 1,
      roomId: 2,
      startTime: '2026-05-04 14:00:00',
      endTime: '2026-05-04 15:00:00',
      needsApproval: true,
      ...context
    },
    steps: {},
    retry: {},
    events: {},
    lastError: null
  };
}

function effect(type, name, options = {}) {
  return { type, name, ...options };
}

function call(name, options) {
  return effect('call', name, options);
}

function wait(name, options) {
  return effect('wait', name, options);
}

function parallel(name, effects) {
  return effect('parallel', name, { effects });
}

function* bookingWorkflow(ctx) {
  yield call('validate');

  const booking = yield call('create_booking', {
    task: 'createBooking',
    compensate: 'cancel_booking'
  });

  if (ctx.forceFatalAfterBooking) {
    yield effect('fail', 'fatal_after_booking', {
      message: 'fatal error after booking created'
    });
  }

  if (booking.bookingStatus === 'pending') {
    yield wait('wait_approval');
  }

  yield parallel('after_approval', [
    call('sendEmail', {
      retries: 2,
      fallback: 'enqueueEmailRetry'
    }),
    call('writeAuditLog')
  ]);

  return { done: true };
}

function stepIndex(stepName) {
  const index = StepOrder.indexOf(stepName);
  return index === -1 ? StepOrder.length : index;
}

async function runEffect(state, yieldedEffect) {
  if (yieldedEffect.type === 'call') {
    return runCallEffect(state, yieldedEffect);
  }

  if (yieldedEffect.type === 'wait') {
    return runWaitEffect(state, yieldedEffect);
  }

  if (yieldedEffect.type === 'parallel') {
    return runParallelEffect(state, yieldedEffect);
  }

  if (yieldedEffect.type === 'fail') {
    throw new Error(yieldedEffect.message);
  }

  throw new Error(`unknown effect type: ${yieldedEffect.type}`);
}

async function runCallEffect(state, yieldedEffect) {
  const stepName = yieldedEffect.name;
  const taskName = yieldedEffect.task || yieldedEffect.name;

  if (state.steps[stepName]?.status === 'success') {
    console.log(`[skip] ${stepName} already completed`);
    return state.steps[stepName].output;
  }

  state.steps[stepName] = {
    status: 'running',
    input: state.context,
    startedAt: new Date().toISOString()
  };
  await saveState(state);

  try {
    const output = await tasks[taskName](state.context, state);
    state.context = { ...state.context, ...output };
    state.steps[stepName] = {
      ...state.steps[stepName],
      status: 'success',
      output,
      finishedAt: new Date().toISOString()
    };
    await saveState(state);
    return output;
  } catch (e) {
    state.retry[stepName] = (state.retry[stepName] || 0) + 1;
    state.steps[stepName] = {
      ...state.steps[stepName],
      status: 'failed',
      error: e.message,
      failedAt: new Date().toISOString()
    };
    state.lastError = e.message;
    await saveState(state);

    if (state.retry[stepName] <= (yieldedEffect.retries || 0)) {
      console.log(`[retry] ${stepName}, attempt ${state.retry[stepName]}`);
      return runCallEffect(state, yieldedEffect);
    }

    if (yieldedEffect.fallback) {
      console.log(`[fallback] ${stepName}`);
      const output = await tasks[yieldedEffect.fallback](state.context, state);
      state.context = { ...state.context, ...output };
      return output;
    }

    throw e;
  }
}

async function runWaitEffect(state, yieldedEffect) {
  const stepName = yieldedEffect.name;

  if (state.events.approved) {
    const output = {
      waitingFor: null,
      bookingStatus: 'approved',
      approvedAt: state.context.approvedAt || new Date().toISOString()
    };
    state.context = { ...state.context, ...output };
    state.steps[stepName] = {
      status: 'success',
      input: state.context,
      output,
      finishedAt: new Date().toISOString()
    };
    await saveState(state);
    return output;
  }

  state.status = Status.WAITING;
  state.currentStep = stepName;
  state.context.waitingFor = 'admin_approval';
  state.steps[stepName] = {
    status: 'waiting',
    input: state.context,
    output: { waitingFor: 'admin_approval' },
    startedAt: new Date().toISOString()
  };
  await saveState(state);
  console.log('[waiting] admin approval required');
  return { __waiting: true };
}

async function runParallelEffect(state, yieldedEffect) {
  const results = await Promise.all(
    yieldedEffect.effects.map(item => runEffect(state, item))
  );
  const output = Object.assign({}, ...results);
  state.context = { ...state.context, ...output };
  state.steps[yieldedEffect.name] = {
    status: 'success',
    input: state.context,
    output,
    finishedAt: new Date().toISOString()
  };
  await saveState(state);
  return output;
}

async function compensateBooking(state) {
  state.status = Status.COMPENSATING;
  await saveState(state);

  if (state.context.bookingId) {
    console.log('[compensate] cancel booking because workflow failed');
    state.context.bookingStatus = 'cancelled';
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
  const iterator = bookingWorkflow(state.context);
  let input;

  try {
    while (true) {
      const next = iterator.next(input);
      if (next.done) break;

      const yieldedEffect = next.value;
      if (stepIndex(yieldedEffect.name) < stepIndex(state.currentStep)) {
        input = state.steps[yieldedEffect.name]?.output;
        continue;
      }

      state.status = Status.RUNNING;
      state.currentStep = yieldedEffect.name;
      await saveState(state);

      input = await runEffect(state, yieldedEffect);
      if (input?.__waiting) return;
    }

    state.status = Status.COMPLETED;
    state.currentStep = 'done';
    await saveState(state);
    console.log('[completed]', state.context);
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
  state.events.approved = true;
  state.status = Status.RUNNING;
  state.context.waitingFor = null;
  state.context.bookingStatus = 'approved';
  state.context.approvedAt = new Date().toISOString();
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
