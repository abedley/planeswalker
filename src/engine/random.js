/**
 * Seeded PRNG (mulberry32) so games, and tests, can be replayed exactly. The
 * returned function also has `getState()` and `setState(state)`, so a game can be
 * saved and restored mid-way.
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  random.getState = () => a;
  random.setState = (state) => { a = state >>> 0; };
  return random;
}

/** Fisher–Yates shuffle, in place. */
export function shuffle(array, random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
