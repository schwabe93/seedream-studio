const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https://*"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"]
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Ensure directories exist
const dirs = ['data', 'data/references', 'data/outputs', 'data/outputs/images', 'data/outputs/videos', 'logs'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Database setup
const db = new sqlite3.Database('./data/database.sqlite');

db.serialize(() => {
  // Settings (API key, preferences)
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Saved prompts
  db.run(`CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Reference folders
  db.run(`CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Reference images
  db.run(`CREATE TABLE IF NOT EXISTS reference_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER,
    filename TEXT NOT NULL,
    original_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
  )`);

  // Generated outputs
  db.run(`CREATE TABLE IF NOT EXISTS outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT CHECK(type IN ('image', 'video')),
    prompt TEXT,
    model TEXT,
    filename TEXT,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default settings
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'dark')`);
});

// Multer config for reference images
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
const uploadRef = multer({ 
  storage: refStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// Routes

// Main Studio Page
app.get('/', async (req, res) => {
  const prompts = await dbAll('SELECT * FROM prompts ORDER BY created_at DESC');
  const folders = await dbAll('SELECT * FROM folders ORDER BY created_at DESC');
  
  // Get images count per folder
  for (let folder of folders) {
    const count = await dbGet('SELECT COUNT(*) as count FROM reference_images WHERE folder_id = ?', [folder.id]);
    folder.image_count = count.count;
  }
  
  const apiKey = await dbGet('SELECT value FROM settings WHERE key = ?', ['atlas_api_key']);
  
  res.render('studio', { 
    prompts, 
    folders, 
    apiKey: apiKey ? apiKey.value : '',
    page: 'studio'
  });
});

// Gallery Page
app.get('/gallery', async (req, res) => {
  const { type, search, page = 1 } = req.query;
  const limit = 24;
  const offset = (page - 1) * limit;
  
  let where = ['1=1'];
  let params = [];
  
  if (type && type !== 'all') {
    where.push('type = ?');
    params.push(type);
  }
  if (search) {
    where.push('(prompt LIKE ? OR model LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  
  const outputs = await dbAll(
    `SELECT * FROM outputs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  
  const count = await dbGet(
    `SELECT COUNT(*) as total FROM outputs WHERE ${where.join(' AND ')}`,
    params
  );
  
  res.render('gallery', {
    outputs,
    page: 'gallery',
    currentPage: parseInt(page),
    totalPages: Math.ceil(count.total / limit),
    filter: { type, search }
  });
});

// Prompts Management Page
app.get('/prompts', async (req, res) => {
  const prompts = await dbAll('SELECT * FROM prompts ORDER BY created_at DESC');
  res.render('prompts', { prompts, page: 'prompts' });
});

// API: Settings
app.post('/api/settings', async (req, res) => {
  const { key, value } = req.body;
  await dbRun('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [key, value]);
  res.json({ success: true });
});

app.get('/api/settings/:key', async (req, res) => {
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', [req.params.key]);
  res.json({ value: row ? row.value : null });
});

// API: Prompts
app.get('/api/prompts', async (req, res) => {
  const rows = await dbAll('SELECT * FROM prompts ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/prompts', async (req, res) => {
  const { name, text, tags } = req.body;
  const result = await dbRun('INSERT INTO prompts (name, text, tags) VALUES (?, ?, ?)', [name, text, tags]);
  res.json({ id: result.lastID });
});

app.delete('/api/prompts/:id', async (req, res) => {
  await dbRun('DELETE FROM prompts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// API: Folders & References
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
    const path = `./data/references/${img.folder_id}/${img.filename}`;
    if (fs.existsSync(path)) fs.unlinkSync(path);
    await dbRun('DELETE FROM reference_images WHERE id = ?', [req.params.id]);
  }
  res.json({ success: true });
});

// API: Generation (Atlas Cloud)
app.post('/api/generate', async (req, res) => {
  const { type, prompt, model, options } = req.body;
  
  try {
    const apiKeyRow = await dbGet('SELECT value FROM settings WHERE key = ?', ['atlas_api_key']);
    if (!apiKeyRow || !apiKeyRow.value) {
      return res.status(400).json({ error: 'API key not configured' });
    }
    
    // Call Atlas Cloud API
    const endpoint = type === 'video' ? 'generateVideo' : 'generateImage';
    const response = await axios.post(`https://api.atlascloud.ai/api/v1/model/${endpoint}`, {
      model,
      prompt,
      ...options
    }, {
      headers: { 'Authorization': `Bearer ${apiKeyRow.value}` },
      timeout: 300000 // 5min
    });
    
    const predictionId = response.data.data.id;
    
    // Poll for completion
    const outputs = await pollPrediction(predictionId, apiKeyRow.value);
    
    // Download and save files
    const savedFiles = [];
    for (const url of outputs) {
      const ext = type === 'video' ? 'mp4' : 'jpg';
      const filename = `seedream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`;
      const filepath = path.join('data/outputs', type + 's', filename);
      
      // Download file
      const fileResponse = await axios.get(url, { responseType: 'stream', timeout: 60000 });
      const writer = fs.createWriteStream(filepath);
      fileResponse.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      
      // Get dimensions for images
      let width, height, duration;
      if (type === 'image') {
        // Simple parsing for common image dimensions could be added here
        const dims = options.size ? options.size.split('*') : [1024, 1024];
        width = parseInt(dims[0]);
        height = parseInt(dims[1]);
      } else {
        duration = options.duration || 8;
      }
      
      const stats = fs.statSync(filepath);
      
      const result = await dbRun(
        `INSERT INTO outputs (type, prompt, model, filename, file_size, width, height, duration, metadata) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [type, prompt, model, filename, stats.size, width, height, duration, JSON.stringify(options)]
      );
      
      savedFiles.push({
        id: result.lastID,
        url: `/outputs/${type}s/${filename}`,
        filename
      });
    }
    
    res.json({ success: true, files: savedFiles });
    
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});

async function pollPrediction(id, apiKey) {
  const url = `https://api.atlascloud.ai/api/v1/model/prediction/${id}`;
  const maxAttempts = 60; // 2 minutes
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const resp = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    const data = resp.data.data;
    if (data.status === 'completed') return data.outputs;
    if (data.status === 'failed') throw new Error(data.error || 'Generation failed');
  }
  
  throw new Error('Timeout waiting for generation');
}

// Serve output files
app.use('/outputs', express.static(path.join(__dirname, 'data/outputs')));

// API: Outputs management
app.delete('/api/outputs/:id', async (req, res) => {
  const output = await dbGet('SELECT * FROM outputs WHERE id = ?', [req.params.id]);
  if (output) {
    const filepath = path.join('data/outputs', output.type + 's', output.filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    await dbRun('DELETE FROM outputs WHERE id = ?', [req.params.id]);
  }
  res.json({ success: true });
});

// Helper functions for SQLite
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Seedream Studio running on http://0.0.0.0:${PORT}`);
});