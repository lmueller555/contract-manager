'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

function scrapeWithPlaywright(request, options = {}) {
  const python = options.pythonExecutable || process.env.PYTHON_EXECUTABLE || 'python3';
  const script = options.script || path.join(__dirname, 'playwright_scraper.py');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => reject(new Error(`Unable to start the Python Playwright scraper: ${error.message}`)));
    child.on('close', code => {
      let result;
      try { result = JSON.parse(stdout); } catch { return reject(new Error(`Python Playwright returned invalid output${stderr ? `: ${stderr.trim()}` : '.'}`)); }
      if (code !== 0 || result.error) return reject(new Error(result.error || stderr.trim() || `Python Playwright exited with code ${code}.`));
      resolve(result);
    });
    child.stdin.end(JSON.stringify(request));
  });
}

module.exports = { scrapeWithPlaywright };
