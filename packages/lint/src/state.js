
const map = new Map();

export const fileState = {
  set(file, state) {
    map.set(file, state);
  },
  get(file) {
    return map.get(file);
  },
  delete(file) {
    map.delete(file);
  }
};
