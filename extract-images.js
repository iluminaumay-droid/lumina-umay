import fs from 'fs';
import path from 'path';

const outDir = path.join(process.cwd(), 'src', 'client', 'images');
fs.mkdirSync(outDir, { recursive: true });

const mdContent = fs.readFileSync(path.join(process.cwd(), 'ORIGINAL_REQUEST.md'), 'utf8');
const matches = mdContent.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/g);

if (matches && matches.length >= 1) {
  const heroB64 = matches[0].replace('data:image/jpeg;base64,', '');
  fs.writeFileSync(path.join(outDir, 'hero.jpg'), Buffer.from(heroB64, 'base64'));
  
  const claudiaB64 = (matches[1] || matches[0]).replace('data:image/jpeg;base64,', '');
  fs.writeFileSync(path.join(outDir, 'claudia.jpg'), Buffer.from(claudiaB64, 'base64'));
  console.log('✅ Extracted hero.jpg and claudia.jpg successfully');
} else {
  console.log('No base64 matches found in ORIGINAL_REQUEST.md');
}
