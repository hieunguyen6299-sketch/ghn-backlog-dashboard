const fs = require('fs');
const raw = fs.readFileSync('data/hr-data.csv', 'utf-8');
const lines = raw.split('\n').filter(l => l.trim());
console.log('HEADER:', lines[0]);
console.log('---');
for (let i = 1; i < lines.length; i++) {
    const cols = [];
    let c = '', q = false;
    for (const ch of lines[i]) {
        if (ch === '"') q = !q;
        else if (ch === ',' && !q) { cols.push(c.trim()); c = ''; }
        else if (ch !== '\r') c += ch;
    }
    cols.push(c.trim());
    if (cols[10]) {
        console.log('Row ' + i);
        cols.forEach((v, j) => console.log('  [' + j + '] = ' + v));
        if (i > 5) break;
    }
}
