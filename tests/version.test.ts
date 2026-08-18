import { describe, it, expect } from 'vitest';
import {
  APP_VERSION,
  APP_NAME,
  APP_RELEASE_NAME,
  APP_USER_AGENT,
  BACKEND_COMPONENTS,
  getSystemVersionReport,
} from '../server/version';

describe('Version Registry and Backend Component Tracking', () => {
  it('has base application version set to 1.0.0', () => {
    expect(APP_VERSION).toBe('1.0.0');
    expect(APP_NAME).toBe('Graywood Reader');
    expect(APP_RELEASE_NAME).toBe('Genesis');
    expect(APP_USER_AGENT).toBe('Graywood-Reader/1.0.0');
  });

  it('tracks all required backend components with valid semver format', () => {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    const requiredComponents = [
      'core_server',
      'sqlite_dal',
      'security_crypto',
      'rate_limiter',
      'scraper_engine',
      'bot_defense',
      'opds_server',
      'local_library',
      'notes_engine',
    ];

    for (const key of requiredComponents) {
      expect(BACKEND_COMPONENTS[key]).toBeDefined();
      const comp = BACKEND_COMPONENTS[key];
      expect(comp.name).toBeTruthy();
      expect(comp.version).toMatch(semverRegex);
      expect(comp.entrypoint).toBeTruthy();
      expect(comp.description).toBeTruthy();
      expect(comp.category).toMatch(/^(core|database|security|crawler|integration|storage)$/);
    }
  });

  it('generates a complete system version report', () => {
    const report = getSystemVersionReport();
    expect(report.app.version).toBe('1.0.0');
    expect(report.app.name).toBe('Graywood Reader');
    expect(report.components.core_server.version).toBe('1.0.0');
    expect(report.runtime.node).toBe(process.version);
    expect(report.runtime.platform).toBe(process.platform);
    expect(typeof report.runtime.uptimeSeconds).toBe('number');
    expect(typeof report.runtime.memoryUsageMB).toBe('number');
  });
});
