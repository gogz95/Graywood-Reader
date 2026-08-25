import { Router, Request, Response } from 'express';
import AdmZip from 'adm-zip';
import { SqliteDb } from '../../sqlite-db';
import { scanStorage } from './localLibrary';
import { kotatsuImageEngine, matchLiveDomain, autoDiscoverLiveSourceForManga } from '../services/crawlerEngine';
import { fetchWithSsrfGuard } from '../security';

export const opdsRouter = Router();

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// Serve covers through the same-origin image proxy so e-readers (KOReader,
// Moon+, Panels, Paperback) can fetch them without hotlink blocks.
function proxiedCover(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('/api/') || rawUrl.startsWith('data:')) return rawUrl;
  return `/api/proxy/image?url=${encodeURIComponent(rawUrl)}`;
}

const CATALOG_FEED_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';

function feedHeader(title: string, updated: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:uuid:graywood-reader-opds-catalog</id>
  <title>${title}</title>
  <updated>${updated}</updated>
  <author>
    <name>Graywood Reader</name>
  </author>
  <link rel="self" href="/api/opds/catalog.xml" type="${CATALOG_FEED_TYPE}"/>
  <link rel="start" href="/api/opds/catalog.xml" type="${CATALOG_FEED_TYPE}"/>
`;
}

function entryForManga(manga: any): string {
  const title = escapeXml(manga.title);
  const desc = escapeXml(manga.description || `Reading progress: Chapter ${manga.currentChapter} / ${manga.latestChapter}`);
  const cover = escapeXml(proxiedCover(manga.coverImage));
  const type = manga.type ? escapeXml(manga.type) : 'manga';
  const updated = escapeXml(manga.lastUpdated || new Date().toISOString());
  return `  <entry>
    <title>${title}</title>
    <id>urn:uuid:graywood-series-${escapeXml(manga.id)}</id>
    <updated>${updated}</updated>
    <summary>${desc}</summary>
    <dc:language>en</dc:language>
    <dc:format>${type}</dc:format>
    <link rel="http://opds-spec.org/image" href="${cover}" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="${cover}" type="image/jpeg"/>
    <link rel="subsection" href="/api/opds/series/${encodeURIComponent(manga.id)}" type="${CATALOG_FEED_TYPE}"/>
  </entry>
`;
}

// GET /api/opds/catalog.xml - Root OPDS 1.2 Acquisition Feed with search + pagination
opdsRouter.get('/api/opds/catalog.xml', (req: Request, res: Response) => {
  try {
    const allManga = SqliteDb.getAllManga();
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q ? allManga.filter((m) => (m.title || '').toLowerCase().includes(q)) : allManga;

    // OPDS 1.2 pagination (startIndex / maxRecords)
    const startIndex = Math.max(0, Number(req.query.startIndex) || 0);
    const maxRecords = Math.min(200, Math.max(1, Number(req.query.maxRecords) || 50));
    const page = filtered.slice(startIndex, startIndex + maxRecords);

    const updated = new Date().toISOString();
    let xml = feedHeader('Graywood Reader Catalog', updated);

    // OpenSearch description so OPDS readers can expose a search box.
    xml += `  <link rel="search" type="application/opensearchdescription+xml" href="/api/opds/search" title="Search Graywood Reader catalog"/>\n`;

    const nextStart = startIndex + page.length;
    if (nextStart < filtered.length) {
      xml += `  <link rel="next" href="/api/opds/catalog.xml?startIndex=${nextStart}&amp;maxRecords=${maxRecords}" type="${CATALOG_FEED_TYPE}"/>\n`;
    }

    for (const manga of page) {
      xml += entryForManga(manga);
    }

    // Surface local CBZ archives as read-offline OPDS entries.
    for (const archive of scanStorage()) {
      const title = escapeXml(archive.title);
      const cover = escapeXml(`/api/local/library/${archive.id}/cover`);
      const pages = archive.type === 'cbz' ? archive.pageCount : 0;
      xml += `  <entry>
    <title>${title}</title>
    <id>urn:uuid:graywood-local-${escapeXml(archive.id)}</id>
    <updated>${updated}</updated>
    <summary>Local archive (${archive.type.toUpperCase()}) — ${pages || '?'} pages.</summary>
    <dc:language>en</dc:language>
    <dc:format>cbz</dc:format>
    <link rel="http://opds-spec.org/image" href="${cover}" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="${cover}" type="image/jpeg"/>
    <link rel="subsection" href="/api/opds/local/${archive.id}" type="${CATALOG_FEED_TYPE}"/>
  </entry>
`;
    }

    xml += `  <totalResults>${filtered.length}</totalResults>\n</feed>`;

    res.setHeader('Content-Type', `${CATALOG_FEED_TYPE};charset=utf-8`);
    res.send(xml);
  } catch (err: any) {
    res.status(500).send(`<?xml version="1.0"?><error>${escapeXml(err.message)}</error>`);
  }
});

// GET /api/opds/search - OpenSearch description powering catalog search
opdsRouter.get('/api/opds/search', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/opensearchdescription+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Graywood Reader</ShortName>
  <Description>Search the Graywood Reader catalog.</Description>
  <Url type="${CATALOG_FEED_TYPE}" template="/api/opds/catalog.xml?q={searchTerms}&amp;startIndex={startIndex?}&amp;maxRecords={count?}"/>
</OpenSearchDescription>`);
});

// GET /api/opds/series/:id - Series Chapter Acquisition Feed
opdsRouter.get('/api/opds/series/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const manga = SqliteDb.getMangaById(id);
    if (!manga) {
      return res.status(404).send('<?xml version="1.0"?><error>Series not found</error>');
    }

    const updated = new Date().toISOString();
    const title = escapeXml(manga.title);
    const cover = escapeXml(proxiedCover(manga.coverImage));

    let xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:uuid:graywood-series-${escapeXml(manga.id)}</id>
  <title>${title}</title>
  <updated>${updated}</updated>
  <author>
    <name>Graywood Reader</name>
  </author>
  <link rel="self" href="/api/opds/series/${encodeURIComponent(manga.id)}" type="${CATALOG_FEED_TYPE}"/>
  <link rel="up" href="/api/opds/catalog.xml" type="${CATALOG_FEED_TYPE}"/>
`;

    const totalChapters = Math.max(manga.latestChapter, manga.currentChapter, 1);
    for (let ch = totalChapters; ch >= 1; ch--) {
      xml += `  <entry>
    <title>${title} - Chapter ${ch}</title>
    <id>urn:uuid:graywood-series-${escapeXml(manga.id)}-ch-${ch}</id>
    <updated>${updated}</updated>
    <summary>Chapter ${ch} of ${title}</summary>
    <link rel="http://opds-spec.org/image" href="${cover}" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="${cover}" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition" href="/api/opds/download/${encodeURIComponent(manga.id)}/${ch}.cbz" type="application/vnd.comicbook+zip"/>
    <link rel="http://vaemendis.net/opds-pse/stream" href="/api/opds/stream/${encodeURIComponent(manga.id)}/${ch}/{pageNumber}" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition/web" href="/reader/${encodeURIComponent(manga.id)}/${ch}" type="text/html"/>
  </entry>
`;
    }

    xml += `</feed>`;
    res.setHeader('Content-Type', `${CATALOG_FEED_TYPE};charset=utf-8`);
    res.send(xml);
  } catch (err: any) {
    res.status(500).send(`<?xml version="1.0"?><error>${escapeXml(err.message)}</error>`);
  }
});

// GET /api/opds/download/:id/:ch.cbz - On-the-fly CBZ generation for e-readers
opdsRouter.get(['/api/opds/download/:id/:ch.cbz', '/api/opds/download/:id/:ch'], async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const ch = Math.max(1, Number(req.params.ch) || 1);
    const manga = SqliteDb.getMangaById(id);
    if (!manga) return res.status(404).send('Series not found');

    let targetUrl = manga.sourceUrl || '';
    if (!targetUrl || targetUrl.toLowerCase().includes('mangadex.org')) {
      if (manga.availableSources && manga.availableSources.length > 0) {
        const alt = manga.availableSources.find(
          (s) => s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org')
        );
        if (alt) targetUrl = alt.sourceUrl;
      }
      if (!targetUrl || targetUrl.toLowerCase().includes('mangadex.org')) {
        const auto = await autoDiscoverLiveSourceForManga(manga);
        if (auto) targetUrl = auto.sourceUrl;
      }
    }

    let realPages: string[] = [];
    if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
      const matched = matchLiveDomain(targetUrl);
      const domainId = matched ? matched.id : 'general';
      try {
        realPages = await kotatsuImageEngine.getChapterPages(targetUrl, domainId, ch);
      } catch {
        realPages = [];
      }
    }

    const zip = new AdmZip();

    if (realPages && realPages.length > 0) {
      const pageBuffers = await Promise.all(
        realPages.map(async (pageUrl, idx) => {
          try {
            const fetchRes = await fetchWithSsrfGuard(pageUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': targetUrl,
              },
              signal: AbortSignal.timeout(15000),
            });
            if (fetchRes.ok) {
              const arrayBuf = await fetchRes.arrayBuffer();
              return { name: `page_${String(idx + 1).padStart(3, '0')}.jpg`, data: Buffer.from(arrayBuf) };
            }
          } catch {}
          return null;
        })
      );

      for (const p of pageBuffers) {
        if (p) zip.addFile(p.name, p.data);
      }
    }

    const comicInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>${escapeXml(manga.title)} Chapter ${ch}</Title>
  <Series>${escapeXml(manga.title)}</Series>
  <Number>${ch}</Number>
  <Summary>${escapeXml(manga.description || '')}</Summary>
  <Genre>${escapeXml(manga.genres?.join(', ') || '')}</Genre>
  <Manga>${manga.type === 'manga' ? 'YesAndRightToLeft' : 'Yes'}</Manga>
</ComicInfo>`;
    zip.addFile('ComicInfo.xml', Buffer.from(comicInfoXml, 'utf-8'));

    const zipBuffer = zip.toBuffer();
    const sanitizedTitle = (manga.title || 'Chapter').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.comicbook+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}_ch${ch}.cbz"`);
    res.send(zipBuffer);
  } catch (err: any) {
    res.status(500).send(`Failed to generate CBZ: ${err.message}`);
  }
});

// GET /api/opds/stream/:id/:ch/:page - OPDS-PSE (Page Streaming Extension) single-page streamer
opdsRouter.get('/api/opds/stream/:id/:ch/:page', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const ch = Math.max(1, Number(req.params.ch) || 1);
    const pageNum = Math.max(1, Number(req.params.page) || 1);
    const manga = SqliteDb.getMangaById(id);
    if (!manga) return res.status(404).send('Series not found');

    let targetUrl = manga.sourceUrl || '';
    if (!targetUrl || targetUrl.toLowerCase().includes('mangadex.org')) {
      if (manga.availableSources && manga.availableSources.length > 0) {
        const alt = manga.availableSources.find(
          (s) => s.sourceUrl && s.sourceUrl.startsWith('http') && !s.sourceUrl.toLowerCase().includes('mangadex.org')
        );
        if (alt) targetUrl = alt.sourceUrl;
      }
      if (!targetUrl || targetUrl.toLowerCase().includes('mangadex.org')) {
        const auto = await autoDiscoverLiveSourceForManga(manga);
        if (auto) targetUrl = auto.sourceUrl;
      }
    }

    let realPages: string[] = [];
    if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
      const matched = matchLiveDomain(targetUrl);
      const domainId = matched ? matched.id : 'general';
      try {
        realPages = await kotatsuImageEngine.getChapterPages(targetUrl, domainId, ch);
      } catch {
        realPages = [];
      }
    }

    const pageIndex = pageNum - 1;
    if (realPages && realPages[pageIndex]) {
      const pageUrl = realPages[pageIndex];
      const fetchRes = await fetchWithSsrfGuard(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': targetUrl,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (fetchRes.ok) {
        const contentType = fetchRes.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        const arrayBuf = await fetchRes.arrayBuffer();
        return res.send(Buffer.from(arrayBuf));
      }
    }

    // Fallback: Redirect to reader panel generator
    return res.redirect(`/api/reader/panel-image?manga=${encodeURIComponent(manga.title)}&chapter=${ch}&page=${pageNum}`);
  } catch (err: any) {
    res.status(500).send(`Failed to stream page: ${err.message}`);
  }
});

// GET /api/opds/local/:id - Local archive page feed (each page = an image acquisition).
// NOTE: registered at module scope (it was previously nested inside the series
// handler above, so it only existed after the first series request and leaked
// duplicate registrations on every call).
opdsRouter.get('/api/opds/local/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const archive = scanStorage().find((a) => a.id === id);
    if (!archive || archive.type !== 'cbz') {
      return res.status(404).send('<?xml version="1.0"?><error>Local archive not found</error>');
    }
    const updated = new Date().toISOString();
    const title = escapeXml(archive.title);

    let xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:uuid:graywood-local-${escapeXml(archive.id)}</id>
  <title>${title}</title>
  <updated>${updated}</updated>
  <link rel="up" href="/api/opds/catalog.xml" type="${CATALOG_FEED_TYPE}"/>
`;
    for (let i = 0; i < archive.pageCount; i++) {
      xml += `  <entry>
    <title>${title} - Page ${i + 1}</title>
    <id>urn:uuid:graywood-local-${escapeXml(archive.id)}-p-${i}</id>
    <updated>${updated}</updated>
    <link rel="http://opds-spec.org/acquisition" href="/api/local/library/${archive.id}/page/${i}" type="image/jpeg"/>
  </entry>
`;
    }
    xml += `</feed>`;
    res.setHeader('Content-Type', `${CATALOG_FEED_TYPE};charset=utf-8`);
    res.send(xml);
  } catch (err: any) {
    res.status(500).send(`<?xml version="1.0"?><error>${escapeXml(err.message)}</error>`);
  }
});

// GET /api/opds/v2/catalog.json - OPDS 2.0 JSON Catalog Feed
opdsRouter.get('/api/opds/v2/catalog.json', (req: Request, res: Response) => {
  try {
    const allManga = SqliteDb.getAllManga();
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q ? allManga.filter((m) => (m.title || '').toLowerCase().includes(q)) : allManga;

    const publications = filtered.map((m) => ({
      metadata: {
        '@type': 'http://schema.org/ComicStory',
        title: m.title,
        identifier: `urn:uuid:graywood-series-${m.id}`,
        modified: m.lastUpdated || new Date().toISOString(),
        description: m.description || `Reading progress: Chapter ${m.currentChapter} / ${m.latestChapter}`,
        readingProgress: {
          currentChapter: m.currentChapter,
          latestChapter: m.latestChapter,
        },
      },
      images: m.coverImage ? [{ href: proxiedCover(m.coverImage), type: 'image/jpeg' }] : [],
      links: [
        {
          rel: 'http://opds-spec.org/acquisition',
          href: `/reader/${encodeURIComponent(m.id)}/1`,
          type: 'text/html',
        },
        {
          rel: 'self',
          href: `/api/opds/v2/series/${encodeURIComponent(m.id)}.json`,
          type: 'application/opds+json',
        },
      ],
    }));

    res.setHeader('Content-Type', 'application/opds+json;charset=utf-8');
    res.json({
      metadata: {
        title: 'Graywood Reader Catalog (OPDS 2.0)',
        numberOfItems: filtered.length,
      },
      links: [
        { rel: 'self', href: '/api/opds/v2/catalog.json', type: 'application/opds+json' },
      ],
      publications,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate OPDS 2.0 feed', details: err.message });
  }
});


