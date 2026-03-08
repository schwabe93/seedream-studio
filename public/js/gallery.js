async function deleteOutput(id) {
  if (!confirm('Delete this item?')) return;
  
  await fetch(`/api/outputs/${id}`, { method: 'DELETE' });
  location.reload();
}

function downloadFile(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = url.split('/').pop();
  a.click();
}

function openPreview(type, url) {
  const modal = document.getElementById('previewModal');
  const img = document.getElementById('previewImage');
  const vid = document.getElementById('previewVideo');
  
  if (type === 'video') {
    img.style.display = 'none';
    vid.style.display = 'block';
    vid.src = url;
    vid.play();
  } else {
    vid.style.display = 'none';
    img.style.display = 'block';
    img.src = url;
  }
  
  modal.classList.add('show');
}

function closePreview() {
  document.getElementById('previewModal').classList.remove('show');
  document.getElementById('previewVideo').pause();
}

function applyFilter() {
  const type = document.getElementById('filterType').value;
  window.location.href = '/gallery?type=' + type;
}

// Close modal on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePreview();
});