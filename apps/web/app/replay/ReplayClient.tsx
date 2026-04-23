'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './replay.module.css';

type ReplayBundle = {
  config: {
    p1FighterId: string;
    p2FighterId: string;
    stageId?: string;
  };
  p1: { totalFrames: number };
  p2: { totalFrames: number };
  confirmedInputs?: unknown[];
};

function isReplayBundle(v: unknown): v is ReplayBundle {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return Boolean(b.config && b.p1 && b.p2);
}

export function ReplayClient() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [bundle, setBundle] = useState<ReplayBundle | null>(null);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState('5');
  const [dragging, setDragging] = useState(false);

  const tryParse = (raw: string) => {
    if (!raw.trim()) {
      setBundle(null);
      setError('');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!isReplayBundle(parsed)) {
        setBundle(null);
        setError('Invalid bundle: missing config, p1, or p2 fields');
        return;
      }
      setBundle(parsed);
      setError('');
    } catch (err) {
      setBundle(null);
      setError(`Invalid JSON: ${(err as Error).message}`);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.json')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      setText(content);
      tryParse(content);
    };
    reader.readAsText(file);
  };

  const handlePlay = () => {
    if (!bundle) return;
    sessionStorage.setItem('__REPLAY_BUNDLE', JSON.stringify(bundle));
    router.push(`/play?replay=1&speed=${speed}`);
  };

  const totalFrames = bundle ? Math.max(bundle.p1.totalFrames, bundle.p2.totalFrames) : 0;
  const confirmed = bundle?.confirmedInputs?.length ?? 0;

  return (
    <div className={styles.container}>
      <h1>REPLAY</h1>
      <p className={styles.subtitle}>Paste a replay bundle JSON or drag &amp; drop a .json file</p>
      <textarea
        className={`${error ? styles.error : ''} ${dragging ? styles.dragging : ''}`}
        placeholder="Paste bundle JSON here..."
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          tryParse(e.target.value);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      />
      <p className={styles.dropHint}>Or drag &amp; drop a .json file onto the text area</p>
      {error && <div className={styles.errorMsg}>{error}</div>}
      <div className={styles.controls}>
        <button type="button" onClick={handlePlay} disabled={!bundle}>
          PLAY
        </button>
        <label>
          Speed:
          <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
            <option value="5">5x</option>
            <option value="10">10x</option>
          </select>
        </label>
      </div>
      {bundle && (
        <div className={styles.info}>
          <div className={styles.row}>
            <span className={styles.label}>P1</span>
            <span className={styles.value}>{bundle.config.p1FighterId}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>P2</span>
            <span className={styles.value}>{bundle.config.p2FighterId}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Stage</span>
            <span className={styles.value}>{bundle.config.stageId || 'random'}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Frames</span>
            <span className={styles.value}>{totalFrames}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Confirmed inputs</span>
            <span className={styles.value}>
              {confirmed > 0 ? `${confirmed} entries` : 'none (will use raw inputs)'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
