
export const difference = <T,>(setA: Set<T>, setB: Set<T>): Set<T> => {
  const _difference = new Set(setA);
  for (const elem of setB) {
    _difference.delete(elem);
  }
  return _difference;
};

export const intersection = <T,>(setA: Set<T>, setB: Set<T>): Set<T> => {
  const _intersection = new Set<T>();
  for (const elem of setB) {
    if (setA.has(elem)) {
      _intersection.add(elem);
    }
  }
  return _intersection;
};

export const union = <T,>(...sets: Set<T>[]): Set<T> => {
  const _union = new Set<T>();
  for (const set of sets) {
    for (const elem of set) {
      _union.add(elem);
    }
  }
  return _union;
};
