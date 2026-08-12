const fs = require('fs');

const content = fs.readFileSync('server.ts', 'utf8');

// The legacy domain extraction block we want to replace
const oldBlock = `const domainMatch = content.match(/ConfigKey\.Domain\(\s*"([^"]+)"\)/);
              const domain = domainMatch ? domainMatch[1] : \`${id}.com\`;
              const baseUrl = \`https://\${domain}\`;`;

const newBlock = `              const { baseUrl, reliable } = extractParserDomain(content, id);`;

const idx = content.indexOf(oldBlock);
console.log('Found old block at index:', idx);

if (idx >= 0) {
  const newContent = content.substring(0, idx) + newBlock + content.substring(idx + oldBlock.length);
  fs.writeFileSync('server.ts', newContent);
  console.log('REPLACE successful!');
} else {
  console.log('Old block NOT found');
  // Try to find just the first line
  const firstLine = `const domainMatch = content.match(/ConfigKey\.Domain\(\s*"([^"]+)"\)/);`;
  const idx2 = content.indexOf(firstLine);
  console.log('First line found at:', idx2);
  if (idx2 >= 0) {
    console.log('Context:', JSON.stringify(content.substring(idx2, idx2 + 300)));
  }
}
