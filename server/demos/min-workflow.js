import fs from 'fs/promises';
import path from 'path';

const stateFile = path.resolve('/tmp/min-workflow-state.json');

const Steps = {
  VALIDATE: 'validate',
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

function createInitialState() {
  return {
    workflowId: `wf_${Date.now()}`,
    status: Status.RUNNING,
    currentStep: Steps.VALIDATE,
    context: {
      userId: 1,
      roomId: 2,
      startTime: '2026-05-04 14:00:00',
      endTime: '2026-05-04 15:00:00',
      needsApproval: true
    },
    steps: {},
    retry: {},
    events: {},
    lastError: null
  };
}

function createCompensationDemoState() {
  const state = createInitialState();
  state.context.forceFatalAfterBooking = true;
  return state;
}

async function runStep(state, name, task, options = {}) {
  if (state.steps[name]?.status === 'success') {
    console.log(`[skip] ${name} already completed`);
    return state.steps[name].output;
  }

  state.steps[name] = {
    status: 'running',
    input: state.context,
    startedAt: new Date().toISOString()
  };
  await saveState(state);

  try {
    const output = await task(state.context, state);
    state.context = { ...state.context, ...output };
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
      return options.fallback(state.context, state);
    }

    throw e;
  }
}

async function validateBooking(ctx) {
  if (!ctx.userId || !ctx.roomId) {
    throw new Error('invalid booking input');
  }
  return { validated: true };
}

async function createBooking(ctx) {
  console.log('[side effect] insert booking');
  return {
    bookingId: 123,
    bookingStatus: ctx.needsApproval ? 'pending' : 'approved'
  };
}

async function waitApproval(ctx, state) {
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

async function sendEmail(ctx, state) {
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

async function enqueueEmailRetry(ctx, state) {
  state.context.emailRetryQueued = true;
  await saveState(state);
  return { emailRetryQueued: true };
}

async function compensateBooking(ctx, state) {
  state.status = Status.COMPENSATING;
  await saveState(state);

  if (ctx.bookingId) {
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

  try {
    if (state.currentStep === Steps.VALIDATE) {
      await runStep(state, Steps.VALIDATE, validateBooking);
      state.currentStep = Steps.CREATE_BOOKING;
      await saveState(state);
    }

    if (state.currentStep === Steps.CREATE_BOOKING) {
      await runStep(state, Steps.CREATE_BOOKING, createBooking);
      if (state.context.forceFatalAfterBooking) {
        throw new Error('fatal error after booking created');
      }
      state.currentStep = state.context.needsApproval ? Steps.WAIT_APPROVAL : Steps.AFTER_APPROVAL;
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

      state.context = { ...state.context, ...emailResult, ...auditResult };
      state.status = Status.COMPLETED;
      state.currentStep = Steps.DONE;
      await saveState(state);
    }

    console.log('[completed]', state.context);
  } catch (e) {
    console.log('[failed]', e.message);
    await compensateBooking(state.context, state);
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
  state.steps[Steps.WAIT_APPROVAL] = {
    ...(state.steps[Steps.WAIT_APPROVAL] || {}),
    status: 'success',
    output: {
      waitingFor: null,
      bookingStatus: 'approved',
      approvedAt: state.context.approvedAt
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
  await saveState(createCompensationDemoState());
  await runWorkflow();
} else {
  await runWorkflow();
}
