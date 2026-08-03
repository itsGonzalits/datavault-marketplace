/* ============================================================
   DataVault — normalize.js
   File parsing + Gemini AI normalization pipeline
   Accepts any file type, returns structured JSON + preview
   ============================================================ */

'use strict';

const DVNormalize = (() => {

  /* ----------------------------------------------------------
     SUPPORTED LOCAL PARSERS (no AI needed for these)
     ---------------------------------------------------------- */
  const LOCAL_PARSERS = {
    csv:  parseCSV,
    tsv:  parseTSV,
    json: parseJSON,
    txt:  parseTXT,
  };

  /* ----------------------------------------------------------
     MIME → extension map
     ---------------------------------------------------------- */
  function getExtension(file) {
    const name = file.name.toLowerCase();
    const ext  = name.split('.').pop();
    return ext;
  }

  function isLocallyParseable(file) {
    return ['csv','tsv','json','txt'].includes(getExtension(file));
  }

  /* ----------------------------------------------------------
     MAIN ENTRY POINT
     Accepts any file, returns normalized result.
     ---------------------------------------------------------- */
  async function normalizeFile(file, geminiApiKey, onStatus) {
    const status = (msg, step) => onStatus && onStatus(msg, step);

    status('Reading your file…', 1);
    await delay(400);

    let result;

    if (isLocallyParseable(file)) {
      status('Parsing your data…', 2);
      result = await parseLocally(file);
    } else {
      status('AI is organizing your data… 🤖', 2);
      result = await parseWithGemini(file, geminiApiKey, status);
    }

    status('Cleaning and standardizing…', 3);
    await delay(300);
    result = cleanResult(result);

    status('Done! ✅', 4);
    return result;
  }

  /* ----------------------------------------------------------
     LOCAL PARSING (CSV, JSON, TXT)
     ---------------------------------------------------------- */
  async function parseLocally(file) {
    const text = await readAsText(file);
    const ext  = getExtension(file);

    switch (ext) {
      case 'csv': return parseCSV(text);
      case 'tsv': return parseTSV(text);
      case 'json': return parseJSON(text);
      case 'txt': return parseTXT(text);
      default: return { headers: [], rows: [], error: 'Unknown format' };
    }
  }

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { headers: [], rows: [] };

    const headers = splitCSVLine(lines[0]);
    const rows    = lines.slice(1).map(line => {
      const vals = splitCSVLine(line);
      const row  = {};
      headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
      return row;
    });
    return { headers, rows, rowCount: rows.length, colCount: headers.length };
  }

  function parseTSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { headers: [], rows: [] };
    const headers = lines[0].split('\t').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const vals = line.split('\t');
      const row  = {};
      headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
      return row;
    });
    return { headers, rows, rowCount: rows.length, colCount: headers.length };
  }

  function parseJSON(text) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data) && data.length) {
        const headers = Object.keys(data[0]);
        return { headers, rows: data, rowCount: data.length, colCount: headers.length };
      }
      if (typeof data === 'object') {
        // Flat object → single row
        const headers = Object.keys(data);
        return { headers, rows: [data], rowCount: 1, colCount: headers.length };
      }
    } catch (e) {
      return { headers: ['value'], rows: [{ value: text }], rowCount: 1, colCount: 1 };
    }
  }

  function parseTXT(text) {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    return {
      headers: ['line_number', 'content'],
      rows: lines.map((l, i) => ({ line_number: i + 1, content: l })),
      rowCount: lines.length,
      colCount: 2,
    };
  }

  function splitCSVLine(line) {
    const result = [];
    let inQuotes = false;
    let current  = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  /* ----------------------------------------------------------
     GEMINI AI PARSING (for PDFs, images, Excel, Word, etc.)
     Uses Gemini 1.5 Flash (free tier: 1,500 req/day)
     ---------------------------------------------------------- */
  async function parseWithGemini(file, apiKey, onStatus) {
    if (!apiKey) {
      // Fallback: return file metadata only
      onStatus('No AI key — returning file info only.', 2);
      return {
        headers: ['filename', 'type', 'size_kb'],
        rows: [{ filename: file.name, type: file.type, size_kb: (file.size/1024).toFixed(1) }],
        rowCount: 1,
        colCount: 3,
        aiParsed: false,
        note: 'Add a Gemini API key to enable full AI data extraction.',
      };
    }

    try {
      const base64 = await readAsBase64(file);
      const mimeType = file.type || 'application/octet-stream';

      const prompt = `You are a data extraction expert. 
Extract all structured data from this file and return it as valid JSON with this exact format:
{
  "headers": ["column1", "column2", ...],
  "rows": [
    {"column1": "value", "column2": "value", ...},
    ...
  ],
  "summary": "Brief 1-sentence description of what this data contains",
  "dataTypes": {"column1": "string|number|date|boolean", ...}
}

Rules:
- Infer column names from context if not explicitly labeled
- Parse dates into ISO 8601 format (YYYY-MM-DD)
- Remove duplicate rows
- Clean up whitespace
- If this appears to be tabular/spreadsheet data, extract all rows
- If this is a receipt or invoice, extract line items as rows
- If this is a form, extract fields as columns
- Return ONLY valid JSON, no markdown, no explanation`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64 } }
              ]
            }],
            generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
          })
        }
      );

      if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

      const data = await response.json();
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) throw new Error('Empty response from Gemini');

      const parsed = JSON.parse(content);
      return {
        headers:   parsed.headers   || [],
        rows:      parsed.rows      || [],
        rowCount:  (parsed.rows || []).length,
        colCount:  (parsed.headers || []).length,
        summary:   parsed.summary   || '',
        dataTypes: parsed.dataTypes || {},
        aiParsed:  true,
      };

    } catch (err) {
      console.warn('Gemini parsing failed:', err);
      // Graceful fallback
      return {
        headers:  ['filename', 'size_bytes', 'type'],
        rows: [{ filename: file.name, size_bytes: file.size, type: file.type }],
        rowCount: 1,
        colCount: 3,
        aiParsed: false,
        error: err.message,
      };
    }
  }

  /* ----------------------------------------------------------
     CLEAN RESULT (standardize, infer types, compute stats)
     ---------------------------------------------------------- */
  function cleanResult(result) {
    if (!result || !result.rows || !result.rows.length) return result;

    // Infer types
    const types = {};
    result.headers.forEach(h => {
      const vals = result.rows.map(r => r[h]).filter(v => v !== '' && v !== null && v !== undefined);
      types[h] = inferType(vals);
    });

    // Completeness score
    const total = result.rows.length * result.headers.length;
    const filled = result.rows.reduce((sum, row) =>
      sum + result.headers.filter(h => row[h] !== '' && row[h] !== null && row[h] !== undefined).length
    , 0);
    const completeness = total > 0 ? Math.round((filled / total) * 100) : 0;

    return {
      ...result,
      dataTypes: result.dataTypes || types,
      completeness,
      previewRows: result.rows.slice(0, 5),  // First 5 rows for UI preview
    };
  }

  function inferType(values) {
    if (!values.length) return 'string';
    const sample = values.slice(0, 20);
    const isNum  = sample.every(v => !isNaN(parseFloat(v)) && isFinite(v));
    if (isNum) return 'number';
    const isDate = sample.every(v => !isNaN(Date.parse(v)) && /\d{4}|\d{1,2}[\/\-]\d{1,2}/.test(v));
    if (isDate) return 'date';
    const isBool = sample.every(v => ['true','false','yes','no','1','0'].includes(String(v).toLowerCase()));
    if (isBool) return 'boolean';
    return 'string';
  }

  /* ----------------------------------------------------------
     RENDER PREVIEW TABLE into a DOM element
     ---------------------------------------------------------- */
  function renderPreviewTable(container, result) {
    if (!container) return;
    if (!result || !result.headers || !result.previewRows) {
      container.innerHTML = '<p class="text-secondary text-sm">No preview available.</p>';
      return;
    }

    const { headers, previewRows, rowCount, colCount, completeness } = result;

    container.innerHTML = `
      <div class="data-preview">
        <div class="data-preview__header">
          <span class="data-preview__title">📊 Data Preview (first 5 rows)</span>
          <span class="data-preview__meta">
            ${rowCount?.toLocaleString() || '?'} rows · ${colCount || headers.length} columns · ${completeness || '?'}% complete
          </span>
        </div>
        <div class="data-preview__scroll">
          <table class="table">
            <thead>
              <tr>${headers.map(h =>
                `<th contenteditable="true" title="Click to rename this column">${h}</th>`
              ).join('')}</tr>
            </thead>
            <tbody>
              ${previewRows.map(row => `
                <tr>${headers.map(h =>
                  `<td>${escapeHTML(String(row[h] ?? ''))}</td>`
                ).join('')}</tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Wire up column rename → update result.headers
    container.querySelectorAll('th[contenteditable]').forEach((th, i) => {
      th.addEventListener('blur', () => {
        result.headers[i] = th.textContent.trim() || `column_${i+1}`;
      });
    });
  }

  /* ----------------------------------------------------------
     EXPORT normalized result to CSV string
     ---------------------------------------------------------- */
  function toCSV(result) {
    const { headers, rows } = result;
    const lines = [headers.join(',')];
    rows.forEach(row => {
      lines.push(headers.map(h => {
        const val = String(row[h] ?? '');
        return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(','));
    });
    return lines.join('\n');
  }

  /* ----------------------------------------------------------
     EXPORT normalized result to JSON string
     ---------------------------------------------------------- */
  function toJSON(result) {
    return JSON.stringify({ headers: result.headers, rows: result.rows }, null, 2);
  }

  /* ----------------------------------------------------------
     HELPERS
     ---------------------------------------------------------- */
  function readAsText(file) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = e => res(e.target.result);
      reader.onerror = () => rej(new Error('Failed to read file'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  function readAsBase64(file) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = e => res(e.target.result.split(',')[1]);
      reader.onerror = () => rej(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function escapeHTML(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ----------------------------------------------------------
     PUBLIC API
     ---------------------------------------------------------- */
  return {
    normalizeFile,
    renderPreviewTable,
    toCSV,
    toJSON,
    isLocallyParseable,
  };

})();

window.DVNormalize = DVNormalize;
