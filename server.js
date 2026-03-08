const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https://*"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"]
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Ensure directories exist
const dirs = ['data', 'data/references', 'data/outputs', 'data/outputs/images', 'data/outputs/videos'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Database setup
const db = new sqlite3.Database('./data/database.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS reference_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER,
    filename TEXT NOT NULL,
    original_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT CHECK(type IN ('image', 'video')),
    prompt TEXT,
    model TEXT,
    filename TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

app.get('/prompts', async (req, res) => {
  const prompts = await dbAll('SELECT * FROM prompts ORDER BY created_at DESC');
  res.render('prompts', { prompts, page: 'prompts' });
});

// Multer config
const refStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folderId = req.params.folderId;
    const dir = path.join('data/references', folderId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const uploadRef = multer({ storage: refStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Routes
app.get('/', async (req, res) => {
  const prompts = await dbAll('SELECT * FROM prompts ORDER BY created_at DESC');
  const folders = await dbAll('SELECT * FROM folders ORDER BY created_at DESC');
  
  for (let folder of folders) {
    const count = await dbGet('SELECT COUNT(*) as count FROM reference_images WHERE folder_id = ?', [folder.id]);
    folder.image_count = count.count;
  }
  
  const apiKey = await dbGet('SELECT value FROM settings WHERE key = ?', ['atlas_api_key']);
  
  res.render('studio', { prompts, folders, apiKey: apiKey ? apiKey.value : '', page: 'studio' });
});

app.get('/gallery', async (req, res) => {
  const outputs = await dbAll('SELECT * FROM outputs ORDER BY created_at DESC LIMIT 50');
  res.render('gallery', { outputs, page: 'gallery', filter: {} });
});

// API Routes
app.post('/api/settings', async (req, res) => {
  const { key, value } = req.body;
  await dbRun('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [key, value]);
  res.json({ success: true });
});

app.get('/api/prompts', async (req, res) => {
  const rows = await dbAll('SELECT * FROM prompts ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/prompts', async (req, res) => {
  const { name, text } = req.body;
  const result = await dbRun('INSERT INTO prompts (name, text) VALUES (?, ?)', [name, text]);
  res.json({ id: result.lastID });
});

app.delete('/api/prompts/:id', async (req, res) => {
  await dbRun('DELETE FROM prompts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.post('/api/folders', async (req, res) => {
  const { name } = req.body;
  const result = await dbRun('INSERT INTO folders (name) VALUES (?)', [name]);
  res.json({ id: result.lastID });
});

app.get('/api/folders/:id/images', async (req, res) => {
  const images = await dbAll('SELECT * FROM reference_images WHERE folder_id = ?', [req.params.id]);
  res.json(images);
});

app.post('/api/folders/:folderId/upload', uploadRef.array('images', 10), async (req, res) => {
  const folderId = req.params.folderId;
  const files = req.files;
  
  for (const file of files) {
    await dbRun('INSERT INTO reference_images (folder_id, filename, original_name) VALUES (?, ?, ?)',
      [folderId, file.filename, file.originalname]);
  }
  
  res.json({ uploaded: files.length });
});

app.delete('/api/reference-images/:id', async (req, res) => {
  const img = await dbGet('SELECT * FROM reference_images WHERE id = ?', [req.params.id]);
  if (img) {
    const filepath = `./data/references/${img.folder_id}/${img.filename}`;
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    await dbRun('DELETE FROM reference_images WHERE id = ?', [req.params.id]);
  }
  res.json({ success: true });
});

app.post('/api/generate', async (req, res) => {
  const { type, prompt, model, options } = req.body;
  
  try {
    const apiKeyRow = await dbGet('SELECT value FROM settings WHERE key = ?', ['atlas_api_key']);
    if (!apiKeyRow || !apiKeyRow.value) {
      return res.status(400).json({ error: 'API key not configured' });
    }
    
    const endpoint = type === 'video' ? 'generateVideo' : 'generateImage';
    const response = await axios.post(`https://api.atlascloud.ai/api/v1/model/${endpoint}`, {
      model,
      prompt,
      ...options
    }, {
      headers: { 'Authorization': `Bearer ${apiKeyRow.value}` },
      timeout: 300000
    });
    
    const predictionId = response.data.data.id;
    const outputs = await pollPrediction(predictionId, apiKeyRow.value);
    
    const savedFiles = [];
    for (const url of outputs) {
      const ext = type === 'video' ? 'mp4' : 'jpg';
      const filename = `seedream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`;
      const filepath = path.join('data/outputs', type + 's', filename);
      
      const fileResponse = await axios.get(url, { responseType: 'stream', timeout: 60000 });
      const writer = fs.createWriteStream(filepath);
      fileResponse.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      
      await dbRun(`INSERT INTO outputs (type, prompt, model, filename) VALUES (?, ?, ?, ?)`,
        [type, prompt, model, filename]);
      
      savedFiles.push({ url: `/outputs/${type}s/${filename}`, filename });
    }
    
    res.json({ success: true, files: savedFiles });
    
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use('/outputs', express.static(path.join(__dirname, 'data/outputs')));

async function pollPrediction(id, apiKey) {
  const url = `https://api.atlascloud.ai/api/v1/model/prediction/${id}`;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const resp = await axios.get(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    const data = resp.data.data;
    if (data.status === 'completed') return data.outputs;
    if (data.status === 'failed') throw new Error(data.error || 'Generation failed');
  }
  throw new Error('Timeout');
}

// Helpers
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Seedream Studio running on http://0.0.0.0:${PORT}`);
});