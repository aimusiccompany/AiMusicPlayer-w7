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
    if (appVersionEl) appVersionEl.textContent = 'Sürüm —';
  }

  if (btnShowPassword && passwordInput) {
    btnShowPassword.addEventListener('click', function () {
      var isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      btnShowPassword.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
      btnShowPassword.setAttribute('title', isPassword ? 'Şifreyi gizle' : 'Şifreyi göster');
      btnShowPassword.setAttribute('aria-label', isPassword ? 'Şifreyi gizle' : 'Şifreyi göster');
    });
  }

  /**
   * Supabase hataları İngilizce döner; arayüz Türkçe olduğu için eşliyoruz.
   */
  function translateAuthError(err) {
    var msg = (err && err.message ? String(err.message) : '').toLowerCase();
    if (!msg) return 'Giriş başarısız. Lütfen tekrar deneyin.';
    if (msg.indexOf('invalid login credentials') !== -1) return 'E-posta veya şifre hatalı.';
    if (msg.indexOf('email not confirmed') !== -1) return 'E-posta adresiniz henüz doğrulanmamış.';
    if (msg.indexOf('too many requests') !== -1 || msg.indexOf('rate limit') !== -1) return 'Çok fazla deneme yapıldı. Lütfen biraz bekleyin.';
    if (msg.indexOf('user not found') !== -1) return 'Bu e-posta ile kayıtlı kullanıcı bulunamadı.';
    if (msg.indexOf('failed to fetch') !== -1 || msg.indexOf('network') !== -1 || msg.indexOf('fetch') !== -1) {
      return 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.';
    }
    return err.message || 'Giriş başarısız. Lütfen tekrar deneyin.';
  }

  function setLoading(isLoading) {
    if (!btnLogin) return;
    btnLogin.disabled = isLoading;
    btnLogin.textContent = isLoading ? 'Giriş yapılıyor…' : 'Giriş Yap';
  }

  function goToApp() {
    if (window.electronAPI && window.electronAPI.navigateToApp) {
      window.electronAPI.navigateToApp();
    } else {
      window.location.href = 'index.html';
    }
  }

  if (typeof supabase === 'undefined') {
    if (loginError) loginError.textContent = 'Uygulama bileşenleri yüklenemedi. Lütfen uygulamayı yeniden başlatın.';
    setLoading(false);
    if (btnLogin) btnLogin.disabled = true;
    return;
  }

  // Tek istemci: aynı storageKey ile birden fazla GoTrueClient örneği oluşturmak
  // "Multiple GoTrueClient instances" uyarısına ve oturum kilidi çakışmasına yol açıyordu.
  var client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (loginError) loginError.textContent = '';

    var email = (emailInput.value || '').trim();
    var password = passwordInput.value || '';

    if (!email || !password) {
      if (loginError) loginError.textContent = 'E-posta ve şifre girin.';
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (loginError) loginError.textContent = 'İnternet bağlantısı yok. Bağlantınızı kontrol edin.';
      return;
    }

    setLoading(true);

    client.auth.signInWithPassword({ email: email, password: password })
      .then(function (result) {
        if (result.error) {
          if (loginError) loginError.textContent = translateAuthError(result.error);
          setLoading(false);
          return;
        }
        if (result.data && result.data.session) {
          goToApp();
        } else {
          if (loginError) loginError.textContent = 'Oturum alınamadı. Lütfen tekrar deneyin.';
          setLoading(false);
        }
      })
      .catch(function (err) {
        if (loginError) loginError.textContent = translateAuthError(err);
        setLoading(false);
      });
  });

  // Çıkış yapılmadığı sürece aynı kullanıcı ile açılsın: oturum varsa doğrudan uygulamaya geç
  // ?logout=1 ile açıldıysa çıkıştan geliyoruz; oturum olsa bile uygulamaya atlama, önce signOut ile temizle
  var isLogoutFlow = window.location && window.location.search.indexOf('logout=1') !== -1;
  if (isLogoutFlow) {
    client.auth.signOut().catch(function () {});
  } else {
    client.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (session && session.user) goToApp();
    }).catch(function () {});
  }
})();
