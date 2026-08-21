import { describe, it, expect } from 'vitest';
import {
  ALL_SOURCES_CATALOG,
  KOTATSU_SOURCES,
  getSourceById,
  isSourceAlive,
  isMetadataOnlySource,
  buildFullSourceInventory,
  ensureSourceInRegistry,
  rebuildDeadSourcesSet,
} from '../server/sources/sourcesCatalog';

describe('Standalone Sources Catalog', () => {
  it('loads a comprehensive catalog of 1,000+ sources', () => {
    expect(ALL_SOURCES_CATALOG.length).toBeGreaterThan(1000);
  });

  it('filters active sources without dead sources in KOTATSU_SOURCES', () => {
    expect(KOTATSU_SOURCES.length).toBeGreaterThan(50);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'dynasty')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'reaper')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'batoto')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'comick')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'comickfun')).toBe(false);
    expect(KOTATSU_SOURCES.some((s) => s.id === 'asurascans')).toBe(true);
  });

  it('correctly retrieves sources by ID (case-insensitive)', () => {
    const asura = getSourceById('asurascans');
    expect(asura).toBeDefined();
    expect(asura?.name).toContain('Asura');
    expect(asura?.baseUrl).toMatch(/^https:\/\//);

    const asuraUpper = getSourceById('ASURASCANS');
    expect(asuraUpper).toBeDefined();
    expect(asuraUpper?.id).toBe('asurascans');
  });

  it('correctly identifies metadata-only sources (MangaDex)', () => {
    expect(isMetadataOnlySource('mangadex')).toBe(true);
    expect(isMetadataOnlySource('mangadex', 'https://mangadex.org')).toBe(true);
    expect(isMetadataOnlySource('asurascans')).toBe(false);
  });

  it('correctly validates source aliveness', () => {
    const mockSyncConfig = {
      subdomain: 'test',
      autoUpdateIntervalMinutes: 60,
      enableWebCrawling: true,
      sources: [],
      disabledSources: [],
      removedSources: ['customdeadsource'],
      reactivatedSources: [],
      lastSyncTime: '',
      totalTracked: 0,
    };

    rebuildDeadSourcesSet(mockSyncConfig);

    expect(isSourceAlive('asurascans', mockSyncConfig)).toBe(true);
    expect(isSourceAlive('dynasty', mockSyncConfig)).toBe(false);
    expect(isSourceAlive('batoto', mockSyncConfig)).toBe(false);
    expect(isSourceAlive('comick', mockSyncConfig)).toBe(false);
    expect(isSourceAlive('comickfun', mockSyncConfig)).toBe(false);
    expect(isSourceAlive('customdeadsource', mockSyncConfig)).toBe(false);
  });

  it('allows reactivated sources to override dead status', () => {
    const mockSyncConfig = {
      subdomain: 'test',
      autoUpdateIntervalMinutes: 60,
      enableWebCrawling: true,
      sources: [],
      disabledSources: [],
      removedSources: ['customdeadsource'],
      reactivatedSources: ['customdeadsource'],
      lastSyncTime: '',
      totalTracked: 0,
    };

    expect(isSourceAlive('customdeadsource', mockSyncConfig)).toBe(true);
  });

  it('builds full inventory with accurate states', () => {
    const mockSyncConfig = {
      subdomain: 'test',
      autoUpdateIntervalMinutes: 60,
      enableWebCrawling: true,
      sources: [],
      disabledSources: ['flamecomics'],
      removedSources: [],
      reactivatedSources: [],
      lastSyncTime: '',
      totalTracked: 0,
    };

    const inventory = buildFullSourceInventory(mockSyncConfig);
    expect(inventory.length).toBeGreaterThan(1000);

    const mangadex = inventory.find((s) => s.id === 'mangadex');
    expect(mangadex?.isMetadataOnly).toBe(true);
    expect(mangadex?.status).toBe('metadata');

    const flame = inventory.find((s) => s.id === 'flamecomics');
    expect(flame?.status).toBe('disabled');
  });

  it('ensures dynamic source registration via ensureSourceInRegistry', () => {
    const src = ensureSourceInRegistry('asurascans');
    expect(src).toBeDefined();
    expect(src?.id).toBe('asurascans');
  });
});
