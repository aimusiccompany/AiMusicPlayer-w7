window.electronAPI.onUpdateReady((data) => {
    const modal = document.getElementById('updateModal');
    const versionSpan = document.getElementById('updateVersionText');
    const installBtn = document.getElementById('btn-install-now');
    const closeBtn = document.getElementById('btn-close-modal');

    // Modal'ı göster
    if (modal && versionSpan) {
        versionSpan.innerText = data.version;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
    }

    // Hemen Yükle için güvenli dinleyici
    if (installBtn) {
        // Eski dinleyicileri temizlemek için (çakışmaları önler)
        const newInstallBtn = installBtn.cloneNode(true);
        installBtn.parentNode.replaceChild(newInstallBtn, installBtn);
        
        newInstallBtn.addEventListener('click', () => {
            window.electronAPI.installUpdateNow();
        });
    }

    // Kapatma butonu için güvenli dinleyici
    if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        
        newCloseBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            console.log('Modal kapatıldı.'); // Konsolda görebilmek için
        });
    }
});