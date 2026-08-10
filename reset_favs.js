const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'database.json');
if (fs.existsSync(dbPath)) {
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  if (db.mangaDatabase && Array.isArray(db.mangaDatabase)) {
    db.mangaDatabase.forEach((m) => {
      m.isFavorite = false;
    });
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    console.log(`[Database Reset] Successfully set isFavorite: false for all ${db.mangaDatabase.length} series.`);
  }
}
