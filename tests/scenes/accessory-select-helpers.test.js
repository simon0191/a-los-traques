import { describe, expect, it } from 'vitest';
import accessoryCatalog from '../../src/data/accessories.json';
import { calibratedCategories } from '../../src/scenes/accessory-select-helpers.js';

// Dummy calibration entry — the helper only looks at keys, so the value
// shape doesn't matter for these tests.
const anyEntry = { idle: { frameCount: 4, frames: [] } };

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
});
