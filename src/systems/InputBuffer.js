/**
 * Input encoding/decoding for compact network transmission.
 * Encodes 9 boolean inputs as a single integer (bits 0-8).
 *
 * Bit layout:
 *   0: left, 1: right, 2: up, 3: down,
 *   4: lp, 5: hp, 6: lk, 7: hk, 8: sp
 */

const INPUT_KEYS = ['left', 'right', 'up', 'down', 'lp', 'hp', 'lk', 'hk', 'sp'];

/**
 * Encode an input object into a single integer.
 * @param {object} inputObj - { left, right, up, down, lp, hp, lk, hk, sp }
 * @returns {number}
 */
export function encodeInput(inputObj) {
  let encoded = 0;
  for (let i = 0; i < INPUT_KEYS.length; i++) {
    if (inputObj[INPUT_KEYS[i]]) {
      encoded |= (1 << i);
    }
  }
  return encoded;
}

/**
 * Decode an integer back into an input object.
 * @param {number} encoded
 * @returns {object}
 */
export function decodeInput(encoded) {
  const result = {};
  for (let i = 0; i < INPUT_KEYS.length; i++) {
    result[INPUT_KEYS[i]] = !!(encoded & (1 << i));
  }
  return result;
}

/**
 * Compare two encoded inputs for equality.
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
export function inputsEqual(a, b) {
  return a === b;
}

/** Empty input constant (no buttons pressed) */
export const EMPTY_INPUT = 0;

/** Mask for movement bits only (left, right, up, down = bits 0-3) */
export const MOVEMENT_MASK = 0b00001111;

/** Mask for attack bits only (lp, hp, lk, hk, sp = bits 4-8) */
export const ATTACK_MASK = 0b111110000;

/**
 * Predict remote input: repeat movement, zero attacks.
 * @param {number} lastInput - Last confirmed encoded input
 * @returns {number}
 */
export function predictInput(lastInput) {
  return lastInput & MOVEMENT_MASK;
}
