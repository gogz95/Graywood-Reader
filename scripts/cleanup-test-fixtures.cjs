const fs = require('fs');
const Database = require('better-sqlite3');

console.log('--- Cleaning data/manga.db ---');
const db = new Database('data/manga.db');
const info = db.prepare(`
  DELETE FROM manga 
  WHERE id LIKE 'test_backup_%'
     OR id LIKE 'manga_mig_%'
     OR id LIKE 'tachi_prog_%'
     OR title = 'Safe Adventure Story'
     OR title = 'Adult Smut Explicit Story'
     OR title = 'Solo Backup Leveling'
     OR title LIKE '%Server Migration Edition%'
     OR (title = 'Solo Leveling' AND coverImage LIKE '%unsplash.com%')
     OR (title = 'Solo Leveling' AND id LIKE 'm_%')
`).run();
console.log('Deleted test rows from SQLite:', info.changes);

const soloRows = db.prepare("SELECT id, title, sourceName, coverImage FROM manga WHERE title = 'Solo Leveling'").all();
console.log('Remaining Solo Leveling rows in SQLite:', soloRows);

console.log('--- Cleaning database.json ---');
if (fs.existsSync('database.json')) {
  const data = JSON.parse(fs.readFileSync('database.json', 'utf8'));
  if (Array.isArray(data.mangaDatabase)) {
    const beforeCount = data.mangaDatabase.length;
    data.mangaDatabase = data.mangaDatabase.filter(m => {
      if (m.id && (m.id.startsWith('test_backup_') || m.id.startsWith('manga_mig_') || m.id.startsWith('tachi_prog_'))) return false;
      if (m.title === 'Safe Adventure Story' || m.title === 'Adult Smut Explicit Story' || m.title === 'Solo Backup Leveling' || (m.title && m.title.includes('Server Migration Edition'))) return false;
      if (m.title === 'Solo Leveling' && m.coverImage && m.coverImage.includes('unsplash.com')) return false;
      if (m.title === 'Solo Leveling' && m.id && m.id.startsWith('m_')) return false;
      return true;
    });
    console.log('Filtered database.json items from', beforeCount, 'to', data.mangaDatabase.length);
    fs.writeFileSync('database.json', JSON.stringify(data, null, 2), 'utf8');
  }
}
console.log('--- Cleanup complete ---');
