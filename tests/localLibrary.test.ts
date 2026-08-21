import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import express from 'express';
import request from 'supertest';
import {
  localLibraryRouter,
  scanStorage,
  findArchive,
  getArchiveEntry,
  clearArchiveCache,
} from '../server/routes/localLibrary';

describe('Local Library Caching & Endpoints', () => {
  let tempDir: string;
  let sampleZipPath: string;
  let app: express.Express;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graywood-local-test-'));
    process.env.STORAGE_PATH = tempDir;
    clearArchiveCache();

    // Create a sample CBZ file with 2 dummy JPEG pages
    sampleZipPath = path.join(tempDir, 'Test Comic Vol 01.cbz');
    const zip = new AdmZip();
    zip.addFile('001.jpg', Buffer.from('fake-jpeg-data-page-1'));
    zip.addFile('002.jpg', Buffer.from('fake-jpeg-data-page-2'));
    zip.writeZip(sampleZipPath);

    app = express();
    app.use(express.json());
    app.use(localLibraryRouter);
  });

  afterEach(() => {
    delete process.env.STORAGE_PATH;
    clearArchiveCache();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('scans and discovers local CBZ archives with correct page count', () => {
    const archives = scanStorage(true);
    expect(archives.length).toBe(1);
    expect(archives[0].title).toBe('Test Comic Vol 01');
    expect(archives[0].type).toBe('cbz');
    expect(archives[0].pageCount).toBe(2);
  });

  it('serves cached results on repeated scanStorage calls', () => {
    const first = scanStorage();
    const second = scanStorage();
    expect(first).toEqual(second);
  });

  it('finds an archive in O(1) from cache', () => {
    const archives = scanStorage(true);
    const id = archives[0].id;
    const found = findArchive(id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(id);
    expect(found?.title).toBe('Test Comic Vol 01');
  });

  it('GET /api/local/library returns scanned archives list', async () => {
    const res = await request(app).get('/api/local/library');
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.archives[0].title).toBe('Test Comic Vol 01');
  });

  it('GET /api/local/library/:id/pages returns reader page list', async () => {
    const archives = scanStorage(true);
    const id = archives[0].id;
    const res = await request(app).get(`/api/local/library/${id}/pages`);
    expect(res.status).toBe(200);
    expect(res.body.pageCount).toBe(2);
    expect(res.body.pages).toEqual([
      `/api/local/library/${id}/page/0`,
      `/api/local/library/${id}/page/1`,
    ]);
  });

  it('GET /api/local/library/:id/page/:n streams individual page image', async () => {
    const archives = scanStorage(true);
    const id = archives[0].id;
    const res = await request(app).get(`/api/local/library/${id}/page/0`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.body.toString('utf8')).toBe('fake-jpeg-data-page-1');
  });

  it('GET /api/local/library/:id/page/:n returns 400 on invalid page index', async () => {
    const archives = scanStorage(true);
    const id = archives[0].id;
    const res = await request(app).get(`/api/local/library/${id}/page/invalid`);
    expect(res.status).toBe(400);
  });

  it('GET /api/local/library/:id/page/:n returns 404 on out-of-range index', async () => {
    const archives = scanStorage(true);
    const id = archives[0].id;
    const res = await request(app).get(`/api/local/library/${id}/page/99`);
    expect(res.status).toBe(404);
  });

  it('POST /api/local/library/rescan forces cache invalidation', async () => {
    const res = await request(app).post('/api/local/library/rescan');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('scans CBR archives and detects zip-compressed CBR pages', () => {
    const cbrPath = path.join(tempDir, 'Sample Manga Vol 02.cbr');
    const zip = new AdmZip();
    zip.addFile('page_1.png', Buffer.from('png-page-1'));
    zip.writeZip(cbrPath);

    const archives = scanStorage(true);
    expect(archives.length).toBe(2);
    const cbr = archives.find((a) => a.fileName.endsWith('.cbr'));
    expect(cbr).toBeDefined();
    expect(cbr?.type).toBe('cbr');
    expect(cbr?.pageCount).toBe(1);
  });

  it('scans PDF files and extracts page count or default SVG frame', () => {
    const pdfPath = path.join(tempDir, 'Artbook.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4 /Type /Page /Type /Page %%EOF');

    const archives = scanStorage(true);
    const pdf = archives.find((a) => a.fileName.endsWith('.pdf'));
    expect(pdf).toBeDefined();
    expect(pdf?.type).toBe('pdf');
    expect(pdf?.pageCount).toBeGreaterThanOrEqual(1);
  });
});
