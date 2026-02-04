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
    if (platform === 'mac-arm') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_aarch64.dmg';
    }
    if (platform === 'mac-intel') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_x64.dmg';
    }
    if (platform === 'linux') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_amd64.AppImage';
    }
    return null;
  }

  function platformAvailable(data, platform) {
    if (!data.platforms) return false;
    if (platform === 'windows') return !!data.platforms['windows-x86_64'];
    if (platform === 'mac-arm') return !!data.platforms['darwin-aarch64'];
    if (platform === 'mac-intel') return !!data.platforms['darwin-x86_64'];
    if (platform === 'linux') return !!data.platforms['linux-x86_64'];
    return false;
  }

  function platformLabel(platform) {
    if (platform === 'windows') return 'Windows';
    if (platform === 'mac-arm') return 'macOS (Apple Silicon)';
    if (platform === 'mac-intel') return 'macOS (Intel)';
    if (platform === 'linux') return 'Linux';
    return platform;
  }

  function platformIcon(platform) {
    if (platform === 'windows') return 'fa-brands fa-windows';
    if (platform === 'mac-arm' || platform === 'mac-intel') return 'fa-brands fa-apple';
    if (platform === 'linux') return 'fa-brands fa-linux';
    return '';
  }

  function init() {
    var os = detectOS();
    var primaryBtn = document.getElementById('beta-download-primary');
    var alsoContainer = document.getElementById('beta-download-also');
    var versionEl = document.getElementById('beta-version');

    // Determine primary platform - Mac users see architecture choice
    var isMac = os === 'mac';
    var primaryPlatform = os === 'linux' ? 'linux' : 'windows';

    // For non-Mac users: these are the "also available" platforms
    var otherPlatforms = isMac
      ? ['windows', 'linux']
      : (primaryPlatform === 'windows' ? ['mac-arm', 'mac-intel', 'linux'] : ['windows', 'mac-arm', 'mac-intel']);

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
    var tabTarget = isMac ? 'mac' : primaryPlatform;
    var detectedTab = document.querySelector('[data-install-tab="' + tabTarget + '"]');
    if (detectedTab) detectedTab.click();

    fetch(LATEST_JSON_URL)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var version = data.version;
        if (versionEl) versionEl.textContent = 'Penpoint v' + version;

        if (primaryBtn) {
          if (isMac) {
            // Mac users: show architecture selection in primary area
            var macArmAvail = platformAvailable(data, 'mac-arm');
            var macIntelAvail = platformAvailable(data, 'mac-intel');

            if (macArmAvail || macIntelAvail) {
              // Replace the single button with two Mac architecture buttons
              var buttonsHTML = '<div class="mac-arch-buttons">';
              buttonsHTML += '<span class="mac-arch-label font-body">Choose your Mac type:</span>';
              buttonsHTML += '<div class="mac-arch-options">';

              if (macArmAvail) {
                buttonsHTML += '<a class="btn btn-primary btn-xl btn-shadow" href="' + buildInstallerUrl(version, 'mac-arm') + '">';
                buttonsHTML += '<i class="fa-brands fa-apple"></i>&ensp;Apple Silicon';
                buttonsHTML += '<span class="mac-arch-hint">M1, M2, M3, M4</span>';
                buttonsHTML += '</a>';
              }

              if (macIntelAvail) {
                buttonsHTML += '<a class="btn ' + (macArmAvail ? 'btn-outline' : 'btn-primary btn-xl btn-shadow') + '" href="' + buildInstallerUrl(version, 'mac-intel') + '">';
                buttonsHTML += '<i class="fa-brands fa-apple"></i>&ensp;Intel';
                buttonsHTML += '<span class="mac-arch-hint">2019 and earlier</span>';
                buttonsHTML += '</a>';
              }

              buttonsHTML += '</div>';
              buttonsHTML += '<span class="mac-arch-help font-body-sm">Not sure? Click  → About This Mac</span>';
              buttonsHTML += '</div>';

              primaryBtn.outerHTML = buttonsHTML;
            } else {
              // No Mac builds available
              primaryBtn.href = RELEASES_PAGE;
              primaryBtn.textContent = 'View Downloads';
            }
          } else {
            // Windows/Linux users: show single primary button
            var primaryAvail = platformAvailable(data, primaryPlatform);

            if (primaryAvail) {
              primaryBtn.href = buildInstallerUrl(version, primaryPlatform);
              primaryBtn.innerHTML = '<i class="' + platformIcon(primaryPlatform) + '"></i>&ensp;Download for ' + platformLabel(primaryPlatform);
            } else {
              primaryBtn.href = RELEASES_PAGE;
              primaryBtn.textContent = 'View Downloads';
            }
          }
        }

        // "Also available for" — show buttons for other platforms
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
