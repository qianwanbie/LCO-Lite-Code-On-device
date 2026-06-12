const fs = require('fs');
const bashrc = '/data/data/com.termux/files/home/.bashrc';
const line = "export CLAUDE_CODE_TMPDIR=$HOME/.tmp\n";
let content = fs.readFileSync(bashrc, 'utf-8');
content = content.split('\n').filter(l => !l.includes('CLAUDE_CODE_TMPDIR')).join('\n');
fs.writeFileSync(bashrc, content.trim() + '\n' + line);
console.log('OK');
