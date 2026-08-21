/**
 * Clear and rebuild the manga database from all working sources.
 * Usage: npm run db:rebuild  OR  npx tsx scripts/rebuild-db.ts
 */
import { SqliteDb } from '../sqlite-db';
import { updateDatabaseWithAllAvailableSeries } from '../server';

async function main() {
  console.log('[Rebuild] Clearing all manga from database...');
  
  // 1. Get all current manga
  const allManga = SqliteDb.getAllManga();
  console.log(`[Rebuild] Found ${allManga.length} existing series to purge`);
  
  // 2. Delete every manga from SQLite
  for (const m of allManga) {
    SqliteDb.deleteManga(m.id);
  }
  
  // 3. Verify cleared
  const remaining = SqliteDb.getAllManga();
  console.log(`[Rebuild] Database cleared. Remaining: ${remaining.length} series`);
  
  // 4. Rebuild from all working sources
  console.log('[Rebuild] Pulling all available series from working sources...');
  const result = await updateDatabaseWithAllAvailableSeries();
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[Rebuild] COMPLETE!');
  console.log(`  New series added:      ${result.totalNew}`);
  console.log(`  Merged with existing:   ${result.totalMerged}`);
  console.log(`  Total in database:      ${result.totalSeriesInDatabase}`);
  console.log('  Source breakdown:', JSON.stringify(result.sourceCounts, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  process.exit(0);
}

main().catch((err) => {
  console.error('[Rebuild] Fatal error:', err);
  process.exit(1);
});
