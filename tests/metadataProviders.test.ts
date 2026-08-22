import { describe, it, expect } from 'vitest';
import {
  fetchAniListMetadata,
  fetchMangaUpdatesMetadata,
  fetchJikanMetadata,
  aggregateMultiSourceMetadata,
} from '../server/services/metadataService';

describe('Multi-Provider Metadata Services', () => {
  it('handles gracefully when provider search yields empty/invalid query', async () => {
    const ani = await fetchAniListMetadata('');
    expect(ani).toBeNull();

    const mu = await fetchMangaUpdatesMetadata('');
    expect(mu).toBeNull();

    const mal = await fetchJikanMetadata('');
    expect(mal).toBeNull();
  });

  it('aggregates multi-source metadata with cover and fallback merge', async () => {
    const res = await aggregateMultiSourceMetadata('NonExistentTitleX1Y2Z3');
    expect(res).toBeDefined();
    expect(res.sources).toBeDefined();
    expect(Array.isArray(res.sources)).toBe(true);
  });
});
