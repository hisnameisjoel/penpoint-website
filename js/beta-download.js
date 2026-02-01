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
    return null;
  }

  function platformAvailable(data, platform) {
    if (!data.platforms) return false;
    if (platform === 'windows') return !!data.platforms['windows-x86_64'];
    if (platform === 'mac') return !!data.platforms['darwin-aarch64'];
    return false;
  }

  function platformLabel(platform) {
    if (platform === 'windows') return 'Windows';
    if (platform === 'mac') return 'macOS';
    return platform;
  }

  function init() {
    var os = detectOS();
    var primaryBtn = document.getElementById('beta-download-primary');
    var secondaryBtn = document.getElementById('beta-download-secondary');
    var versionEl = document.getElementById('beta-version');
    var primaryPlatform = (os === 'mac') ? 'mac' : 'windows';
    var secondaryPlatform = (os === 'mac') ? 'windows' : 'mac';

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
        var secondaryAvail = platformAvailable(data, secondaryPlatform);

        // Primary button — show for detected OS
        if (primaryBtn) {
          if (primaryAvail) {
            primaryBtn.href = buildInstallerUrl(version, primaryPlatform);
            primaryBtn.textContent = 'Download for ' + platformLabel(primaryPlatform);
          } else {
            // Detected OS not available — try showing the other platform as primary instead
            if (secondaryAvail) {
              primaryBtn.href = buildInstallerUrl(version, secondaryPlatform);
              primaryBtn.textContent = 'Download for ' + platformLabel(secondaryPlatform);
              // Swap so secondary logic below doesn't re-show it
              secondaryAvail = false;
            } else {
              primaryBtn.href = RELEASES_PAGE;
              primaryBtn.textContent = 'View Downloads';
            }
          }
        }

        // Secondary button — only show if the other platform is also available
        if (secondaryBtn) {
          if (secondaryAvail) {
            secondaryBtn.href = buildInstallerUrl(version, secondaryPlatform);
            secondaryBtn.textContent = 'Also available for ' + platformLabel(secondaryPlatform);
            secondaryBtn.style.display = '';
          } else {
            secondaryBtn.style.display = 'none';
          }
        }
      })
      .catch(function () {
        if (primaryBtn) {
          primaryBtn.href = RELEASES_PAGE;
          primaryBtn.textContent = 'View Downloads';
        }
        if (secondaryBtn) secondaryBtn.style.display = 'none';
        if (versionEl) versionEl.textContent = '';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
