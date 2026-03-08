let currentMode = 'image';
let selectedReferences = [];
let isGenerating = false;

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(mode));
  });
  
  document.querySelectorAll('.image-opt').forEach(el => el.style.display = mode === 'image' ? 'inline-block' : 'none');
  document.querySelectorAll('.video-opt').forEach(el => el.style.display = mode === 'video' ? 'inline-block' : 'none');
  
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
  
  isGenerating = true;
  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Generating...';
  
  const outputArea = document.getElementById('outputArea');
  const empty = outputArea.querySelector('.empty-state');
  if (empty) empty.style.display = 'none';
  
  const skeleton = document.createElement('div');
  skeleton.className = 'output-card';
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
    
    if (selectedReferences.length > 0 && (model.includes('edit') || model.includes('i2v'))) {
      options.image = selectedReferences[0].dataUrl;
    }
    
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: currentMode, prompt, model, options })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');
    
    skeleton.remove();
    
    data.files.forEach(file => {
      const card = document.createElement('div');
      card.className = 'output-card';
      
      if (currentMode === 'video') {
        card.innerHTML = `
          <video src="${file.url}" controls playsinline style="width:100%;aspect-ratio:16/9;background:#000;"></video>
          <div class="actions">
            <button class="icon-btn" onclick="downloadFile('${file.url}')" title="Download">⬇</button>
          </div>`;
      } else {
        card.innerHTML = `
          <img src="${file.url}" alt="" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover;">
          <div class="actions">
            <button class="icon-btn" onclick="downloadFile('${file.url}')" title="Download">⬇</button>
          </div>`;
      }
      
      outputArea.insertBefore(card, outputArea.firstChild);
    });
    
    showToast(`${data.files.length} ${currentMode}(s) generated!`, 'success');
    
  } catch (err) {
    console.error(err);
    skeleton.remove();
    showToast(err.message, 'error');
  }
  
  isGenerating = false;
  btn.disabled = false;
  btn.querySelector('.btn-text').textContent = 'Generate';
}

async function toggleFolder(header) {
  const folderItem = header.parentElement;
  const isOpen = folderItem.classList.contains('open');
  const folderId = folderItem.dataset.id;
  
  if (!isOpen) {
    const res = await fetch(`/api/folders/${folderId}/images`);
    const images = await res.json();
    
    const grid = folderItem.querySelector('.image-grid');
    grid.innerHTML = images.map(img => `
      <img src="/references/${folderId}/${img.filename}" 
           onclick="toggleReference(${folderId}, '${img.filename}', '/references/${folderId}/${img.filename}', this)"
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
  
  const folderItem = document.querySelector(`[data-id="${folderId}"]`);
  folderItem.classList.remove('open');
  setTimeout(() => toggleFolder(folderItem.querySelector('.folder-header')), 100);
}

function toggleReference(folderId, filename, path, img) {
  const index = selectedReferences.findIndex(r => r.filename === filename);
  
  if (index > -1) {
    selectedReferences.splice(index, 1);
    img.classList.remove('selected');
  } else {
    if (selectedReferences.length >= 4) return showToast('Max 4 references', 'error');
    selectedReferences.push({ folderId, filename, path, dataUrl: path });
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
    <div style="position:relative;">
      <img src="${ref.path}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--accent);">
      <button onclick="removeRef(${i})" style="position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:var(--danger);border:none;color:white;font-size:10px;cursor:pointer;">✕</button>
    </div>
  `).join('');
}

function removeRef(index) {
  selectedReferences.splice(index, 1);
  document.querySelectorAll('.image-grid img.selected').forEach(img => {
    if (!selectedReferences.find(r => img.src.includes(r.filename))) {
      img.classList.remove('selected');
    }
  });
  updateRefPreview();
}

function usePrompt(text) {
  document.getElementById('promptInput').value = text;
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

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

document.getElementById('promptInput')?.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
});