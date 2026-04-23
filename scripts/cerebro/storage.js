/**
 * Transition storage for El Cerebro data collection (RFC 0020 §5).
 *
 * Writes RL transitions to disk in NumPy .npy format so Python's
 * `np.load()` reads them directly with zero conversion.
 *
 * Each batch is a directory containing:
 *   obs.npy       — Float32 [N, OBS_DIM]
 *   actions.npy   — Int32   [N]
 *   rewards.npy   — Float32 [N]
 *   next_obs.npy  — Float32 [N, OBS_DIM]
 *   dones.npy     — Uint8   [N]  (0 or 1)
 *
 * Batches are flushed every `batchSize` transitions (default 10000).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OBS_DIM } from './env.js';

const DEFAULT_BATCH_SIZE = 10000;

/**
 * Write a typed array as a NumPy .npy file (v1.0 format).
 * Supports float32, int32, and uint8.
 *
 * @param {string} filePath
 * @param {Float32Array|Int32Array|Uint8Array} data
 * @param {number[]} shape  e.g. [N] or [N, OBS_DIM]
 */
function writeNpy(filePath, data, shape) {
  const dtypeMap = {
    Float32Array: '<f4',
    Int32Array: '<i4',
    Uint8Array: '|u1',
  };
  const dtype = dtypeMap[data.constructor.name];
  if (!dtype) throw new Error(`Unsupported typed array: ${data.constructor.name}`);

  // NumPy .npy v1.0 header
  const shapeStr = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`;
  const headerData = `{'descr': '${dtype}', 'fortran_order': False, 'shape': ${shapeStr}, }`;
  // Pad header to align data to 64 bytes (numpy convention).
  const magicLen = 6 + 2 + 2; // magic(6) + version(2) + headerLen(2)
  const totalHeaderLen = magicLen + headerData.length + 1; // +1 for \n
  const padding = 64 - (totalHeaderLen % 64);
  const paddedHeader = `${headerData}${' '.repeat(padding)}\n`;
  const headerLenU16 = paddedHeader.length;

  const headerBuf = Buffer.alloc(magicLen + headerLenU16);
  // Magic: \x93NUMPY
  headerBuf[0] = 0x93;
  headerBuf.write('NUMPY', 1);
  // Version 1.0
  headerBuf[6] = 1;
  headerBuf[7] = 0;
  // Header length (little-endian uint16)
  headerBuf.writeUInt16LE(headerLenU16, 8);
  // Header string
  headerBuf.write(paddedHeader, 10);

  const dataBuf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  writeFileSync(filePath, Buffer.concat([headerBuf, dataBuf]));
}

/**
 * Create a transition collector that buffers transitions and flushes
 * to disk in batches.
 *
 * @param {object} opts
 * @param {string} opts.outDir   Base directory (e.g. `data/cerebro/simon/`)
 * @param {number} [opts.batchSize=10000]  Transitions per batch file
 */
export function createStorage({ outDir, batchSize = DEFAULT_BATCH_SIZE }) {
  mkdirSync(outDir, { recursive: true });

  let batchIdx = 0;
  let count = 0;
  let flushedTotal = 0;

  // Pre-allocate batch buffers
  const obs = new Float32Array(batchSize * OBS_DIM);
  const actions = new Int32Array(batchSize);
  const rewards = new Float32Array(batchSize);
  const nextObs = new Float32Array(batchSize * OBS_DIM);
  const dones = new Uint8Array(batchSize);

  /**
   * Add a transition to the buffer. Flushes to disk when batch is full.
   * @param {Float32Array} o     observation (OBS_DIM floats)
   * @param {number} action      action index 0-71
   * @param {number} reward      scalar reward
   * @param {Float32Array} no    next observation (OBS_DIM floats)
   * @param {boolean} done       episode terminated
   */
  function add(o, action, reward, no, done) {
    const offset = count * OBS_DIM;
    obs.set(o, offset);
    actions[count] = action;
    rewards[count] = reward;
    nextObs.set(no, offset);
    dones[count] = done ? 1 : 0;
    count++;

    if (count >= batchSize) flush();
  }

  /** Write the current buffer to disk and reset. */
  function flush() {
    if (count === 0) return;

    const batchDir = join(outDir, `batch_${String(batchIdx).padStart(5, '0')}`);
    mkdirSync(batchDir, { recursive: true });

    // Slice to actual count (last batch may be partial)
    writeNpy(join(batchDir, 'obs.npy'), obs.slice(0, count * OBS_DIM), [count, OBS_DIM]);
    writeNpy(join(batchDir, 'actions.npy'), actions.slice(0, count), [count]);
    writeNpy(join(batchDir, 'rewards.npy'), rewards.slice(0, count), [count]);
    writeNpy(join(batchDir, 'next_obs.npy'), nextObs.slice(0, count * OBS_DIM), [count, OBS_DIM]);
    writeNpy(join(batchDir, 'dones.npy'), dones.slice(0, count), [count]);

    flushedTotal += count;
    batchIdx++;
    count = 0;
  }

  /** Return the total number of transitions written (including current buffer). */
  function totalTransitions() {
    return flushedTotal + count;
  }

  return { add, flush, totalTransitions };
}

export { writeNpy };
