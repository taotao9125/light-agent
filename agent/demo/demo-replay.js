/**
 * 将 committed AgentEvent 投影为 SessionEvent，并在回放时模拟 delta 流式。
 * 逻辑对齐 agent/src/agent/session.ts 的 projectSessionEvents。
 */
(function (global) {
  function getTurnKey(event) {
    const { roundId, turn } = event.meta ?? {};
    if (!roundId || turn == null) return undefined;
    return `${roundId}:${turn}`;
  }

  function chunkText(text, size) {
    const parts = [];
    for (let i = 0; i < text.length; i += size) {
      parts.push(text.slice(i, i + size));
    }
    return parts.length ? parts : [''];
  }

  class SessionProjector {
    constructor() {
      this.activeThoughtTurns = new Set();
      this.activeOutputTurns = new Set();
      this.reset();
    }

    reset() {
      this.activeThoughtTurns.clear();
      this.activeOutputTurns.clear();
    }

    projectDelta(type, text, meta) {
      const event = { type, text, meta };
      if (type === 'thought_delta') {
        const key = getTurnKey(event);
        if (!key || this.activeThoughtTurns.has(key)) {
          return [{ type: 'thought_delta', text, meta }];
        }
        this.activeThoughtTurns.add(key);
        return [
          { type: 'thought_start', meta },
          { type: 'thought_delta', text, meta },
        ];
      }
      if (type === 'output_delta') {
        const key = getTurnKey(event);
        if (!key || this.activeOutputTurns.has(key)) {
          return [{ type: 'output_delta', text, meta }];
        }
        this.activeOutputTurns.add(key);
        return [
          { type: 'output_start', meta },
          { type: 'output_delta', text, meta },
        ];
      }
      return [];
    }

    projectCommitted(event) {
      switch (event.type) {
        case 'input':
          return [
            { type: 'agent_start', meta: event.meta },
            { type: 'input', text: event.text, source: event.source, meta: event.meta },
          ];
        case 'thought': {
          const key = getTurnKey(event);
          if (key) this.activeThoughtTurns.delete(key);
          return [{ type: 'thought_done', text: event.text, meta: event.meta }];
        }
        case 'output': {
          const key = getTurnKey(event);
          if (key) this.activeOutputTurns.delete(key);
          return [{ type: 'output_done', text: event.text, meta: event.meta }];
        }
        case 'action':
          return [
            {
              type: 'action_start',
              id: event.id,
              name: event.name,
              args: event.args,
              meta: event.meta,
            },
          ];
        case 'observation':
          return [
            {
              type: 'action_done',
              id: event.id,
              result: event.result,
              name: event.name,
              meta: event.meta,
              isError: event.isError,
            },
          ];
        case 'summary':
          return [{ type: 'summary', text: event.text, meta: event.meta }];
        case 'agent_error':
          this.activeThoughtTurns.clear();
          this.activeOutputTurns.clear();
          return [{ type: 'agent_error', message: event.message, meta: event.meta }];
        case 'interrupt':
          this.activeThoughtTurns.clear();
          this.activeOutputTurns.clear();
          return [{ type: 'interrupt', reason: event.reason, meta: event.meta }];
        default:
          return [];
      }
    }

    /** 把一条 committed 事件展开为回放步骤 */
    expandForReplay(event, options) {
      const streamChunk = options?.streamChunk ?? 8;
      const streamDelay = options?.streamDelay ?? 35;
      const steps = [];

      const pushInstant = (sessionEvents, sourceSeq) => {
        steps.push({
          kind: 'instant',
          sourceSeq,
          sessionEvents,
        });
      };

      const pushStream = (type, fullText, meta, sourceSeq) => {
        const deltas = chunkText(fullText, streamChunk);
        for (let i = 0; i < deltas.length; i++) {
          const chunk = deltas[i];
          const projected = this.projectDelta(
            type === 'thought' ? 'thought_delta' : 'output_delta',
            chunk,
            meta,
          );
          steps.push({
            kind: 'stream',
            sourceSeq,
            sessionEvents: projected,
            delayMs: i === 0 ? 0 : streamDelay,
          });
        }
        const doneType = type === 'thought' ? 'thought_done' : 'output_done';
        const doneKey = getTurnKey({ meta });
        if (type === 'thought' && doneKey) this.activeThoughtTurns.delete(doneKey);
        if (type === 'output' && doneKey) this.activeOutputTurns.delete(doneKey);
        steps.push({
          kind: 'instant',
          sourceSeq,
          sessionEvents: [{ type: doneType, text: fullText, meta }],
        });
      };

      if (event.type === 'thought' || event.type === 'output') {
        pushStream(event.type, event.text, event.meta, event.seq);
        return steps;
      }

      if (event.type === 'summary') {
        pushInstant([{ type: 'summary', text: event.text, meta: event.meta }], event.seq);
        return steps;
      }

      pushInstant(this.projectCommitted(event), event.seq);
      return steps;
    }
  }

  /** 从完整 log 构建回放时间表 */
  function buildReplaySchedule(log, options) {
    const projector = new SessionProjector();
    const schedule = [];
    let pauseAfterSeq = options?.pauseAfterSeq ?? 400;

    for (const event of log) {
      const steps = projector.expandForReplay(event, options);
      for (const step of steps) {
        schedule.push(step);
      }
      schedule.push({
        kind: 'pause',
        sourceSeq: event.seq,
        delayMs: pauseAfterSeq,
      });
    }

    if (schedule.length && schedule[schedule.length - 1].kind === 'pause') {
      schedule.pop();
    }

    return schedule;
  }

  global.SessionProjector = SessionProjector;
  global.buildReplaySchedule = buildReplaySchedule;
})(window);
