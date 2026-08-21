import { describe, it, expect } from 'vitest';
import {
  extractWeebCentralSeriesId,
  extractWeebCentralChapterId,
} from '../server/scrapers/weebCentral';
import { getSourceById, ALL_SOURCES_CATALOG } from '../server/sources/sourcesCatalog';

describe('Weeb Central Scraper & Registry Verification', () => {
  it('extracts WeebCentral series ID token correctly from URLs and slugs', () => {
    expect(extractWeebCentralSeriesId('https://weebcentral.com/series/01J76XYCPSY3C4BNPBRY8JMCBE/Solo-Leveling'))
      .toBe('01J76XYCPSY3C4BNPBRY8JMCBE');
    expect(extractWeebCentralSeriesId('/series/01J76XY7E9FNDZ1DBBM6PBJPFK/One-Piece'))
      .toBe('01J76XY7E9FNDZ1DBBM6PBJPFK');
    expect(extractWeebCentralSeriesId('https://weebcentral.com/series/01J76XYD7E91K8QP6CY0Y53900'))
      .toBe('01J76XYD7E91K8QP6CY0Y53900');
    expect(extractWeebCentralSeriesId('')).toBeNull();
  });

  it('extracts WeebCentral chapter ID token correctly from URLs', () => {
    expect(extractWeebCentralChapterId('https://weebcentral.com/chapters/01J76XZ666GREP4DQDKEP1YDZG'))
      .toBe('01J76XZ666GREP4DQDKEP1YDZG');
    expect(extractWeebCentralChapterId('/chapters/01J76XZ6614Z72ZP8CDK0PV0V3'))
      .toBe('01J76XZ6614Z72ZP8CDK0PV0V3');
    expect(extractWeebCentralChapterId('')).toBeNull();
  });

  it('has correct Aqua Manga URL in catalog (aquareader.org)', () => {
    const aqua = getSourceById('aquamanga');
    expect(aqua).toBeDefined();
    expect(aqua?.baseUrl).toBe('https://aquareader.org');
  });

  it('has correct Raven Scans URL in catalog (ravenscans.net)', () => {
    const raven = getSourceById('ravenscans');
    expect(raven).toBeDefined();
    expect(raven?.baseUrl).toBe('https://ravenscans.net');
  });

  it('has Weeb Central configured as custom_html in registry', () => {
    const weeb = getSourceById('weebcentral');
    expect(weeb).toBeDefined();
    expect(weeb?.engineType).toBe('custom_html');
    expect(weeb?.baseUrl).toBe('https://weebcentral.com');
  });
});
