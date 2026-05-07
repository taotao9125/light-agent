function deepAssign(target, ...sources) {
  // 合并 state 时保留已有字段，只覆盖传入 newState 中出现的字段。
  for (const source of sources) {
    for (const key in source) {
      const targetVal = target[key];
      const sourceVal = source[key];
      if (typeof sourceVal === "object" && sourceVal !== null && !Array.isArray(sourceVal)) {
        if (typeof targetVal !== "object" || targetVal === null || Array.isArray(targetVal)) {
          target[key] = {};
        }
        deepAssign(target[key], sourceVal);
      } else {
        target[key] = sourceVal;
      }
    }
  }
  return target;
}

export {
  deepAssign
}