const KEY = 'diamond-dash:v1';

const defaults = { best: 0, bestGems: 0, totalGems: 0, runs: 0, muted: false, tutorialDone: false };

function read() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

let state = read();

export const save = {
  get: (k) => state[k],
  set(k, v) {
    state[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable — keep in memory */
    }
  },
};
