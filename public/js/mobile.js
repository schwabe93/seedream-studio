function toggleMobileMenu() {
  document.getElementById('sidebar').classList.toggle('open');
}

// Close sidebar when clicking nav items on mobile
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    if (window.innerWidth <= 1024) {
      toggleMobileMenu();
    }
  });
});

// Swipe gestures for gallery
let touchStartX = 0;
let touchEndX = 0;

document.addEventListener('touchstart', e => {
  touchStartX = e.changedTouches[0].screenX;
});

document.addEventListener('touchend', e => {
  touchEndX = e.changedTouches[0].screenX;
  handleSwipe();
});

function handleSwipe() {
  const modal = document.getElementById('previewModal');
  if (!modal.classList.contains('show')) return;
  
  if (touchEndX < touchStartX - 50) {
    // Swipe left - next
    console.log('next');
  }
  if (touchEndX > touchStartX + 50) {
    // Swipe right - prev
    console.log('prev');
  }
}