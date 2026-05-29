(function (global) {
  const TYPE_COLORS = global.DEMO_TYPE_COLORS || {};

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function groupByRound(events) {
    const map = new Map();
    for (const e of events) {
      const rid = e.meta?.roundId ?? 'unknown';
      if (!map.has(rid)) map.set(rid, []);
      map.get(rid).push(e);
    }
    return [...map.entries()].map(([roundId, evs]) => ({
      roundId,
      events: evs,
      input: evs.find((x) => x.type === 'input' && x.meta?.turn === 0),
    }));
  }

  function computeStats(log) {
    const tools = log.filter((e) => e.type === 'action').length;
    const toolErrors = log.filter((e) => e.type === 'observation' && e.isError).length;
    let tokens = 0;
    let latency = 0;
    for (const e of log) {
      const u = e.meta?.usage;
      if (u) tokens += (u.promptTokens || 0) + (u.completionTokens || 0);
      if (e.meta?.latencyMs) latency += e.meta.latencyMs;
    }
    return {
      events: log.length,
      rounds: new Set(log.map((e) => e.meta?.roundId)).size,
      tools,
      toolErrors,
      tokens,
      latency,
    };
  }

  /** 模拟 contextBuilder pipe */
  function buildContextPipeline(log, opts = {}) {
    const maxRounds = opts.maxRounds ?? 2;
    const summarizeBeforeSeq = opts.summarizeBeforeSeq ?? 12;
    const stages = [];

    stages.push({
      name: '1. 原始 committed log',
      count: log.length,
      events: log,
      note: 'append-only 真相源',
    });

    const committed = log.filter((e) =>
      ['input', 'thought', 'action', 'observation', 'output', 'summary', 'interrupt'].includes(
        e.type,
      ),
    );
    stages.push({
      name: '2. filterCommitted',
      count: committed.length,
      events: committed,
      note: '去掉 delta / 非持久化类型',
    });

    const rounds = groupByRound(committed);
    const recentRoundIds = rounds.slice(-maxRounds).map((r) => r.roundId);
    const afterWindow = committed.filter((e) => {
      if (e.type === 'summary') return true;
      return recentRoundIds.includes(e.meta?.roundId);
    });
    stages.push({
      name: `3. takeRecentRounds(${maxRounds})`,
      count: afterWindow.length,
      events: afterWindow,
      note: `保留 round: ${recentRoundIds.join(', ')}`,
    });

    const withSummary = [];
    let insertedSummary = false;
    for (const e of afterWindow) {
      if (!insertedSummary && e.seq != null && e.seq >= summarizeBeforeSeq && e.type !== 'summary') {
        const sum = log.find((x) => x.type === 'summary');
        if (sum) {
          withSummary.push(sum);
          insertedSummary = true;
        }
      }
      if (e.seq != null && e.seq < summarizeBeforeSeq && e.type !== 'summary' && insertedSummary) {
        continue;
      }
      if (e.type === 'summary' && insertedSummary) continue;
      withSummary.push(e);
    }
    stages.push({
      name: '4. summarizeOldRounds',
      count: withSummary.length,
      events: withSummary,
      note: '旧 round 压缩为一条 summary（发给模型的视图）',
    });

    const tokenEst = withSummary.reduce((n, e) => {
      const t = e.text || e.result || '';
      return n + Math.ceil(String(t).length / 4);
    }, 0);
    stages.push({
      name: '5. → provider adaptor',
      count: withSummary.length,
      events: withSummary,
      note: `估算 ~${tokenEst} tokens · splitEventsToRoundGroups → Chat messages`,
      isFinal: true,
    });

    return stages;
  }

  function diffLogs(base, other) {
    const bySeq = new Map(other.map((e) => [e.seq, e]));
    return base.map((e) => {
      const o = bySeq.get(e.seq);
      if (!o) return { kind: 'removed', base: e };
      if (JSON.stringify(e) !== JSON.stringify(o)) return { kind: 'changed', base: e, other: o };
      return { kind: 'same', base: e };
    }).concat(
      other.filter((o) => !base.some((b) => b.seq === o.seq)).map((o) => ({ kind: 'added', other: o })),
    );
  }

  function eventsToTraceSpans(log) {
    return log
      .filter((e) => e.at && e.meta?.latencyMs != null)
      .map((e) => ({
        seq: e.seq,
        type: e.type,
        label: e.type === 'action' ? e.name : e.type,
        start: new Date(e.at).getTime(),
        duration: e.meta.latencyMs,
        traceId: e.meta?.traceId,
      }));
  }

  function extractToolChains(log) {
    const chains = [];
    const actions = log.filter((e) => e.type === 'action');
    for (const a of actions) {
      const obs = log.find((e) => e.type === 'observation' && e.id === a.id);
      chains.push({ action: a, observation: obs });
    }
    return chains;
  }

  global.DemoUtils = {
    TYPE_COLORS,
    escapeHtml,
    groupByRound,
    computeStats,
    buildContextPipeline,
    diffLogs,
    eventsToTraceSpans,
    extractToolChains,
  };
})(window);
