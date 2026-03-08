let currentMode = 'image';
let selectedReferences = [];
let isGenerating = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadFolders();
  
  // Check API key status
  fetch('/api/settings/atlas_api_key')
    .then(r => r.json())
    .then(data => {
      if (data.value) {
        document.getElementById('statusDot').classList.add('connected');
      }
    });
});

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(mode));
  });
  
  // Toggle options visibility
  document.querySelectorAll('.image-opt').forEach(el => {
    el.style.display = mode === 'image' ? 'block' : 'none';
  });
  document.querySelectorAll('.video-opt').forEach(el => {
    el.style.display = mode === 'video' ? 'block' : 'none';
  });
  
  // Update prompt placeholder
  const textarea = document.getElementById('promptInput');
  textarea.placeholder = mode === 'video' 
    ? 'Describe your video... (camera movement, scene, style)' 
    : 'Describe what you want to generate...';
}

async function generate() {
  if (isGenerating) return;
  
  const prompt = document.getElementById('promptInput').value.trim();
  if (!prompt) return showToast('Please enter a prompt', 'error');
  
  const model = document.getElementById('modelSelect').value;
  const autoSave = document.getElementById('autoSaveToggle').checked;
  
  isGenerating = true;
  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Generating...';
  
  // Add skeleton
  const outputArea = document.getElementById('outputArea');
  const empty = outputArea.querySelector('.empty-state');
  if (empty) empty.style.display = 'none';
  
  const skeleton = document.createElement('div');
  skeleton.className = 'output-card skeleton';
  skeleton.innerHTML = '<div style="aspect-ratio:1;background:var(--surface);display:flex;align-items:center;justify-content:center;"><div class="spinner"></div></div>';
  outputArea.insertBefore(skeleton, outputArea.firstChild);
  
  try {
    const options = currentMode === 'image' ? {
      size: document.getElementById('sizeSelect').value,
      num_images: parseInt(document.getElementById('countSelect').value)
    } : {
      duration: parseInt(document.getElementById('durationSelect').value),
      aspect_ratio: '16:9'
    };
    
    // Add reference if I2V or Image Edit
    if (selectedReferences.length > 0 && (model.includes('edit') || model.includes('i2v'))) {
      options.image = await fileToBase64(selectedReferences[0]);
    }
    
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: currentMode,
        prompt,
        model,
        options
      })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');
    
    // Remove skeleton and add results
    skeleton.remove();
    
    data.files.forEach(file => {
      const card = createOutputCard(file, currentMode, model, prompt);
      outputArea.insertBefore(card, outputArea.firstChild);
    });
    
    showToast(`${data.files.length} ${currentMode}(s) generated!`, 'success');
    
  } catch (err) {
    console.error(err);
    skeleton.remove();
    showToast(err.message, 'error');
    
    if (outputArea.children.length === 0) {
      outputArea.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✦</div>
          <h2>Ready to Create</h2>
          <p>Enter a prompt and click Generate</p>
        </div>
      `;
    }
  }
  
  isGenerating = false;
  btn.disabled = false;
  btn.querySelector('.btn-text').textContent = 'Generate';
}

function createOutputCard(file, type, model, prompt) {
  const div = document.createElement('div');
  div.className = 'output-card';
  
  const media = type === 'video' 
    ? `<video src="${file.url}" controls playsinline></video>`
    : `<img src="${file.url}" alt="" loading="lazy">`;
  
  div.innerHTML = `
    ${media}
    <div class="actions">
      <button class="icon-btn" onclick="downloadFile('${file.url}')" title="Download">⬇</button>
      <button class="icon-btn" onclick="this.closest('.output-card').remove()" title="Dismiss">✕</button>
    </div>
  `;
  
  return div;
}

async function fileToBase64(fileObj) {
  // If it's already a data URL from our selection
  if (fileObj.dataUrl) return fileObj.dataUrl;
  
  // If it's a file input
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsDataURL(fileObj);
  });
}

// Folder management
async function loadFolders() {
  // Images are loaded on demand when folder is opened
}

async function toggleFolder(header) {
  const folderItem = header.parentElement;
  const isOpen = folderItem.classList.contains('open');
  
  if (!isOpen) {
    const folderId = folderItem.dataset.id;
    const res = await fetch(`/api/folders/${folderId}/images`);
    const images = await res.json();
    
    const grid = folderItem.querySelector('.image-grid');
    grid.innerHTML = images.map(img => `
      <img src="/references/${folderId}/${img.filename}" 
           onclick="toggleReference(${folderId}, '${img.filename}', this)"
           class="${selectedReferences.find(r => r.filename === img.filename) ? 'selected' : ''}">
    `).join('');
  }
  
  folderItem.classList.toggle('open');
}

async function uploadImages(folderId, input) {
  const files = input.files;
  if (!files.length) return;
  
  const formData = new FormData();
  for (const file of files) formData.append('images', file);
  
  showToast('Uploading...', 'success');
  
  const res = await fetch(`/api/folders/${folderId}/upload`, {
    method: 'POST',
    body: formData
  });
  
  const data = await res.json();
  showToast(`${data.uploaded} images uploaded`, 'success');
  
  // Refresh folder
  const folderItem = document.querySelector(`[data-id="${folderId}"]`);
  folderItem.classList.remove('open');
  folderItem.querySelector('.folder-header').click();
}

function toggleReference(folderId, filename, img) {
  const index = selectedReferences.findIndex(r => r.filename === filename);
  
  if (index > -1) {
    selectedReferences.splice(index, 1);
    img.classList.remove('selected');
  } else {
    if (selectedReferences.length >= 4) {
      showToast('Max 4 references', 'error');
      return;
    }
    selectedReferences.push({ folderId, filename, dataUrl: img.src });
    img.classList.add('selected');
  }
  
  updateRefPreview();
}

function updateRefPreview() {
  const preview = document.getElementById('refPreview');
  if (!selectedReferences.length) {
    preview.innerHTML = '';
    return;
  }
  
  preview.innerHTML = selectedReferences.map((ref, i) => `
    <div class="ref-thumb">
      <img src="${ref.dataUrl}">
      <button onclick="removeRef(${i})">✕</button>
    </div>
  `).join('');
}

function removeRef(index) {
  selectedReferences.splice(index, 1);
  // Refresh UI
  document.querySelectorAll('.folder-item.open .image-grid img.selected').forEach((img, i) => {
    if (!selectedReferences.find(r => r.dataUrl === img.src)) {
      img.classList.remove('selected');
    }
  });
  updateRefPreview();
}

// Prompts
function usePrompt(text) {
  document.getElementById('promptInput').value = decodeURIComponent(text);
}

function saveCurrentPrompt() {
  const text = document.getElementById('promptInput').value.trim();
  if (!text) return;
  document.getElementById('newPromptName').value = '';
  document.getElementById('savePromptModal').classList.add('show');
}

async function confirmSavePrompt() {
  const name = document.getElementById('newPromptName').value.trim();
  const text = document.getElementById('promptInput').value.trim();
  
  if (!name) return;
  
  await fetch('/api/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text })
  });
  
  showToast('Prompt saved!', 'success');
  closeModal('savePromptModal');
  location.reload();
}

async function createFolder() {
  const name = prompt('Folder name:');
  if (!name) return;
  
  await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  
  location.reload();
}

function downloadFile(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = url.split('/').pop();
  a.click();
}

// API Key
async function saveApiKey() {
  const value = document.getElementById('apiKeyInput').value.trim();
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'atlas_api_key', value })
  });
  document.getElementById('statusDot').classList.add('connected');
  showToast('API Key saved', 'success');
}

// Utilities
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// Keyboard shortcut
document.getElementById('promptInput')?.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    generate();
  }
});