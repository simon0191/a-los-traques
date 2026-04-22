import { describe, expect, it } from 'vitest';
import accessoryCatalog from '../../packages/game/src/data/accessories.json';
import {
  autoPickAccessories,
  calibratedCategories,
} from '../../packages/game/src/scenes/accessory-select-helpers.js';

// Dummy calibration entry. `calibratedCategories` requires a non-null
// idle[0] so preview anchors have something to read; downstream tests that
// only care about the keys reuse this fixture.
const anyEntry = {
  idle: { frameCount: 4, frames: [{ x: 0, y: 0, rotation: 0, scale: 0.2 }] },
};

// Pick one valid category from the shipped catalog so tests stay in sync
// if the catalog ever gains/loses categories.
const VALID_CAT = accessoryCatalog[0].category;
const OTHER_VALID = accessoryCatalog.find((a) => a.category !== VALID_CAT)?.category;

describe('calibratedCategories', () => {
  it('returns an empty array when the manifest is null', () => {
    expect(calibratedCategories(null, 'simon')).toEqual([]);
  });

  it('returns an empty array when the fighter has no calibrations', () => {
    const manifest = { calibrations: {} };
    expect(calibratedCategories(manifest, 'simon')).toEqual([]);
  });

  it('returns the single category when only one is calibrated', () => {
    const manifest = {
      calibrations: { simon: { [VALID_CAT]: anyEntry } },
    };
    expect(calibratedCategories(manifest, 'simon')).toEqual([VALID_CAT]);
  });

  it('returns every calibrated category that exists in the catalog', () => {
    if (!OTHER_VALID) {
      // Catalog only has one category — skip the multi-category assertion.
      return;
    }
    const manifest = {
      calibrations: {
        simon: {
          [VALID_CAT]: anyEntry,
          [OTHER_VALID]: anyEntry,
        },
      },
    };
    const out = calibratedCategories(manifest, 'simon');
    expect(out).toHaveLength(2);
    expect(out).toContain(VALID_CAT);
    expect(out).toContain(OTHER_VALID);
  });

  it('drops categories that are not in the accessory catalog', () => {
    // A manifest entry for a category no longer shipped — shouldn't leak
    // into the UI since no accessory exists for it.
    const manifest = {
      calibrations: {
        simon: {
          [VALID_CAT]: anyEntry,
          pulseras: anyEntry, // hypothetical future category, not shipped
        },
      },
    };
    expect(calibratedCategories(manifest, 'simon')).toEqual([VALID_CAT]);
  });

  it('only inspects the requested fighter', () => {
    const manifest = {
      calibrations: {
        simon: { [VALID_CAT]: anyEntry },
        jeka: { [VALID_CAT]: anyEntry },
      },
    };
    expect(calibratedCategories(manifest, 'peks')).toEqual([]);
  });

  it('drops categories with null/missing idle frames', () => {
    // A half-populated manifest where an existing category key has no
    // anchor frame must not surface as calibrated — the picker would
    // render an empty preview and mis-route confirm.
    const manifest = {
      calibrations: {
        simon: {
          [VALID_CAT]: anyEntry,
          ...(OTHER_VALID ? { [OTHER_VALID]: null } : {}),
        },
      },
    };
    expect(calibratedCategories(manifest, 'simon')).toEqual([VALID_CAT]);
  });
});

describe('autoPickAccessories', () => {
  it('returns an empty object for an uncalibrated fighter', () => {
    expect(autoPickAccessories(null, 'simon')).toEqual({});
    expect(autoPickAccessories({ calibrations: {} }, 'simon')).toEqual({});
  });

  it('returns one pick per calibrated category', () => {
    const manifest = {
      calibrations: { simon: { [VALID_CAT]: anyEntry } },
    };
    const out = autoPickAccessories(manifest, 'simon', () => 0);
    expect(Object.keys(out)).toEqual([VALID_CAT]);
  });

  it('each pick is a valid accessory id matching the category', () => {
    const manifest = {
      calibrations: {
        simon: OTHER_VALID
          ? { [VALID_CAT]: anyEntry, [OTHER_VALID]: anyEntry }
          : { [VALID_CAT]: anyEntry },
      },
    };
    const out = autoPickAccessories(manifest, 'simon');
    for (const [cat, id] of Object.entries(out)) {
      const entry = accessoryCatalog.find((a) => a.id === id);
      expect(entry).toBeDefined();
      expect(entry.category).toBe(cat);
    }
  });

  it('is deterministic given a seeded rng', () => {
    const manifest = {
      calibrations: { simon: { [VALID_CAT]: anyEntry } },
    };
    const seeded = () => 0.75; // deterministic
    const a = autoPickAccessories(manifest, 'simon', seeded);
    const b = autoPickAccessories(manifest, 'simon', seeded);
    expect(a).toEqual(b);
  });

  it('skips a calibrated category that has no catalog options', () => {
    // `pulseras` is not in the shipped catalog, so the helper should not
    // emit it even if the fighter has a calibration for it.
    const manifest = {
      calibrations: {
        simon: { [VALID_CAT]: anyEntry, pulseras: anyEntry },
      },
    };
    const out = autoPickAccessories(manifest, 'simon');
    expect(out).not.toHaveProperty('pulseras');
    expect(out).toHaveProperty(VALID_CAT);
  });
});
