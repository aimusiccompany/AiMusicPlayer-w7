(function () {
  'use strict';

  document.querySelectorAll('img[data-fallback]').forEach(function (img) {
    img.addEventListener('error', function () {
      img.style.display = 'none';
      var next = img.nextElementSibling;
      if (next) next.style.display = 'block';
    });
  });

  var SUPABASE_URL = 'https://api.aimusic.com.tr';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1aXN1aHVlcHZxc2Nzd2NvY3FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTgwNDUzODUsImV4cCI6MjAzMzYyMTM4NX0.Lo0dFFPUNvsLIBxitmsi_mmTtDlVABsqgd74rGrvHq0';

  var form = document.getElementById('login-form');
  var emailInput = document.getElementById('email');
  var passwordInput = document.getElementById('password');
  var btnShowPassword = document.getElementById('btn-show-password');
  var loginError = document.getElementById('login-error');
  var btnLogin = document.getElementById('btn-login');
  var appVersionEl = document.getElementById('app-version');

  if (typeof window.electronAPI !== 'undefined' && window.electronAPI.getAppVersion) {
    window.electronAPI.getAppVersion().then(function (v) {
      if (appVersionEl) appVersionEl.textContent = 'Sürüm ' + (v || '—');
    }).catch(function () {
      if (appVersionEl) appVersionEl.textContent = 'Sürüm —';
    });
  } else {
    if (appVersionEl) appVersionEl.textContent = 'Sürüm 1.0.0';
  }

  btnShowPassword.addEventListener('click', function () {
    var isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    btnShowPassword.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    loginError.textContent = '';
    btnLogin.disabled = true;

    var email = (emailInput.value || '').trim();
    var password = passwordInput.value || '';

    if (!email || !password) {
      loginError.textContent = 'E-posta ve şifre girin.';
      btnLogin.disabled = false;
      return;
    }

    if (typeof supabase === 'undefined') {
      loginError.textContent = 'Supabase yüklenemedi. İnternet bağlantısını kontrol edin.';
      btnLogin.disabled = false;
      return;
    }

    var client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    });

    client.auth.signInWithPassword({ email: email, password: password })
      .then(function (result) {
        if (result.error) {
          loginError.textContent = result.error.message || 'Giriş başarısız.';
          btnLogin.disabled = false;
          return;
        }
        if (result.data.session && window.electronAPI && window.electronAPI.navigateToApp) {
          window.electronAPI.navigateToApp();
        } else if (result.data.session) {
          window.location.href = 'index.html';
        } else {
          loginError.textContent = 'Oturum alınamadı.';
          btnLogin.disabled = false;
        }
      })
      .catch(function (err) {
        loginError.textContent = err.message || 'Bağlantı hatası.';
        btnLogin.disabled = false;
      });
  });

  // Çıkış yapılmadığı sürece aynı kullanıcı ile açılsın: oturum varsa doğrudan uygulamaya geç
  // ?logout=1 ile açıldıysa çıkıştan geliyoruz; oturum olsa bile uygulamaya atlama, önce signOut ile temizle
  var isLogoutFlow = typeof window !== 'undefined' && window.location && window.location.search.indexOf('logout=1') !== -1;
  if (typeof supabase !== 'undefined') {
    var persistClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
    });
    if (isLogoutFlow) {
      persistClient.auth.signOut().then(function () {}).catch(function () {});
    } else {
      persistClient.auth.getSession().then(function (result) {
        var session = result.data && result.data.session;
        if (session && session.user) {
          if (window.electronAPI && window.electronAPI.navigateToApp) {
            window.electronAPI.navigateToApp();
          } else {
            window.location.href = 'index.html';
          }
        }
      }).catch(function () {});
    }
  }
})();
