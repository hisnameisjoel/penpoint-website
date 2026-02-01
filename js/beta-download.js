(function () {
  var LATEST_JSON_URL = 'https://updates.penpoint.app/latest.json';
  var RELEASE_BASE = 'https://github.com/hisnameisjoel/penpoint-updates/releases/download';
  var RELEASES_PAGE = 'https://github.com/hisnameisjoel/penpoint-updates/releases';

  function detectOS() {
    var ua = navigator.userAgent;
    if (/Windows/.test(ua)) return 'windows';
    if (/Mac/.test(ua)) return 'mac';
    if (/Linux/.test(ua)) return 'linux';
    return 'unknown';
  }

  function buildInstallerUrl(version, platform) {
    var tag = 'v' + version;
    if (platform === 'windows') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_x64-setup.exe';
    }
    if (platform === 'mac') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_aarch64.dmg';
    }
    if (platform === 'linux') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_amd64.AppImage';
    }
    return null;
  }

  function platformAvailable(data, platform) {
    if (!data.platforms) return false;
    if (platform === 'windows') return !!data.platforms['windows-x86_64'];
    if (platform === 'mac') return !!data.platforms['darwin-aarch64'];
    if (platform === 'linux') return !!data.platforms['linux-x86_64'];
    return false;
  }

  function platformLabel(platform) {
    if (platform === 'windows') return 'Windows';
    if (platform === 'mac') return 'macOS';
    if (platform === 'linux') return 'Linux';
    return platform;
  }

  function platformIcon(platform) {
    if (platform === 'windows') return 'fa-brands fa-windows';
    if (platform === 'mac') return 'fa-brands fa-apple';
    if (platform === 'linux') return 'fa-brands fa-linux';
    return '';
  }

  function init() {
    var os = detectOS();
    var primaryBtn = document.getElementById('beta-download-primary');
    var alsoContainer = document.getElementById('beta-download-also');
    var versionEl = document.getElementById('beta-version');
    var allPlatforms = ['windows', 'mac', 'linux'];
    var primaryPlatform = os === 'mac' ? 'mac' : os === 'linux' ? 'linux' : 'windows';
    var otherPlatforms = allPlatforms.filter(function (p) { return p !== primaryPlatform; });

    // Show correct install tab
    var tabs = document.querySelectorAll('[data-install-tab]');
    var panels = document.querySelectorAll('[data-install-panel]');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-install-tab');
        tabs.forEach(function (t) { t.classList.remove('install-tab--active'); });
        panels.forEach(function (p) { p.hidden = true; });
        tab.classList.add('install-tab--active');
        var panel = document.querySelector('[data-install-panel="' + target + '"]');
        if (panel) panel.hidden = false;
      });
    });

    // Auto-select the detected OS tab
    var detectedTab = document.querySelector('[data-install-tab="' + primaryPlatform + '"]');
    if (detectedTab) detectedTab.click();

    fetch(LATEST_JSON_URL)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var version = data.version;
        if (versionEl) versionEl.textContent = 'Penpoint v' + version;

        var primaryAvail = platformAvailable(data, primaryPlatform);

        // Primary button — show for detected OS, or fall back to first available
        if (primaryBtn) {
          if (primaryAvail) {
            primaryBtn.href = buildInstallerUrl(version, primaryPlatform);
            primaryBtn.innerHTML = '<i class="' + platformIcon(primaryPlatform) + '"></i>&ensp;Download for ' + platformLabel(primaryPlatform);
          } else {
            var fallback = otherPlatforms.find(function (p) { return platformAvailable(data, p); });
            if (fallback) {
              primaryBtn.href = buildInstallerUrl(version, fallback);
              primaryBtn.innerHTML = '<i class="' + platformIcon(fallback) + '"></i>&ensp;Download for ' + platformLabel(fallback);
              // Remove fallback from "also available" list
              otherPlatforms = otherPlatforms.filter(function (p) { return p !== fallback; });
            } else {
              primaryBtn.href = RELEASES_PAGE;
              primaryBtn.textContent = 'View Downloads';
            }
          }
        }

        // "Also available for" — show buttons for all other available platforms
        if (alsoContainer) {
          var buttonsContainer = alsoContainer.querySelector('.download-area__also-buttons');
          var availableOthers = otherPlatforms.filter(function (p) { return platformAvailable(data, p); });
          if (availableOthers.length > 0) {
            availableOthers.forEach(function (p) {
              var btn = document.createElement('a');
              btn.href = buildInstallerUrl(version, p);
              btn.className = 'btn btn-outline';
              btn.innerHTML = '<i class="' + platformIcon(p) + '"></i>&ensp;' + platformLabel(p);
              buttonsContainer.appendChild(btn);
            });
            alsoContainer.style.display = '';
          }
        }
      })
      .catch(function () {
        if (primaryBtn) {
          primaryBtn.href = RELEASES_PAGE;
          primaryBtn.textContent = 'View Downloads';
        }
        if (alsoContainer) alsoContainer.style.display = 'none';
        if (versionEl) versionEl.textContent = '';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
