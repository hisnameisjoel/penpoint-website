(function () {
  var LATEST_JSON_URL = 'https://updates.penpoint.app/latest.json';
  var RELEASE_BASE = 'https://github.com/hisnameisjoel/penpoint-updates/releases/download';

  function detectOS() {
    var ua = navigator.userAgent;
    if (/Windows/.test(ua)) return 'windows';
    if (/Mac/.test(ua)) return 'mac';
    if (/Linux/.test(ua)) return 'linux';
    return 'unknown';
  }

  // Detect Apple Silicon vs Intel Mac using WebGL GPU renderer
  function detectMacArch() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return null;
      var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return null;
      var renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (/Apple M\d|Apple GPU/i.test(renderer)) return 'mac-arm';
      if (/Intel/i.test(renderer)) return 'mac-intel';
      return null;
    } catch (e) {
      return null;
    }
  }

  // Detect Windows ARM64 using User-Agent Client Hints (Chromium only)
  function detectWindowsArm() {
    if (!navigator.userAgentData || typeof navigator.userAgentData.getHighEntropyValues !== 'function') {
      return Promise.resolve(false);
    }
    return navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness'])
      .then(function (ua) {
        return ua.architecture === 'arm' && ua.bitness === '64';
      })
      .catch(function () { return false; });
  }

  function buildInstallerUrl(version, platform) {
    var tag = 'v' + version;
    if (platform === 'windows') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_x64-setup.exe';
    }
    if (platform === 'windows-arm') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_arm64-setup.exe';
    }
    if (platform === 'mac-arm') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_aarch64.dmg';
    }
    if (platform === 'mac-intel') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_x64.dmg';
    }
    if (platform === 'linux-appimage') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_amd64.AppImage';
    }
    if (platform === 'linux-deb') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_amd64.deb';
    }
    if (platform === 'linux') {
      return RELEASE_BASE + '/' + tag + '/Penpoint_' + version + '_amd64.AppImage';
    }
    return null;
  }

  function platformAvailable(data, platform) {
    if (!data.platforms) return false;
    if (platform === 'windows') return !!data.platforms['windows-x86_64'];
    if (platform === 'windows-arm') return !!data.platforms['windows-aarch64'];
    if (platform === 'mac-arm') return !!data.platforms['darwin-aarch64'];
    if (platform === 'mac-intel') return !!data.platforms['darwin-x86_64'];
    if (platform === 'linux' || platform === 'linux-appimage' || platform === 'linux-deb') return !!data.platforms['linux-x86_64'];
    return false;
  }

  function platformLabel(platform) {
    if (platform === 'windows') return 'Windows';
    if (platform === 'windows-arm') return 'Windows (ARM)';
    if (platform === 'mac-arm') return 'macOS (Apple Silicon)';
    if (platform === 'mac-intel') return 'macOS (Intel)';
    if (platform === 'linux-appimage') return 'Linux (AppImage)';
    if (platform === 'linux-deb') return 'Linux (Deb)';
    if (platform === 'linux') return 'Linux';
    return platform;
  }

  function platformIcon(platform) {
    if (platform === 'windows' || platform === 'windows-arm') return 'fa-brands fa-windows';
    if (platform === 'mac-arm' || platform === 'mac-intel') return 'fa-brands fa-apple';
    if (platform === 'linux' || platform === 'linux-appimage' || platform === 'linux-deb') return 'fa-brands fa-linux';
    return '';
  }

  function init() {
    var os = detectOS();
    var primaryBtn = document.getElementById('beta-download-primary');
    var alsoContainer = document.getElementById('beta-download-also');
    var versionEl = document.getElementById('beta-version');

    // Determine primary platform (async for Windows ARM detection)
    var isMac = os === 'mac';
    var macArch = isMac ? detectMacArch() : null;
    var isWindows = os === 'windows';

    var armDetection = isWindows ? detectWindowsArm() : Promise.resolve(false);
    armDetection.then(function (isWindowsArm) {
    var isLinux = os === 'linux';
    var primaryPlatform = isMac
      ? (macArch || 'mac')  // detected arch or generic 'mac'
      : isWindows
        ? (isWindowsArm ? 'windows-arm' : 'windows')
        : (isLinux ? 'linux' : 'windows');

    // For non-Mac users or detected Mac arch: build "also available" list
    var otherPlatforms;
    if (isMac && macArch) {
      // Detected Mac arch: show the other Mac variant + other platforms
      var otherMac = macArch === 'mac-arm' ? 'mac-intel' : 'mac-arm';
      otherPlatforms = [otherMac, 'windows', 'windows-arm', 'linux-appimage', 'linux-deb'];
    } else if (isMac) {
      // Mac but couldn't detect arch: will show both Mac buttons as primary
      otherPlatforms = ['windows', 'linux-appimage', 'linux-deb'];
    } else if (isWindows) {
      // Show the other Windows variant + other platforms
      var otherWin = isWindowsArm ? 'windows' : 'windows-arm';
      otherPlatforms = [otherWin, 'mac-arm', 'mac-intel', 'linux-appimage', 'linux-deb'];
    } else if (isLinux) {
      // Linux: will show both format buttons as primary
      otherPlatforms = ['windows', 'windows-arm', 'mac-arm', 'mac-intel'];
    } else {
      otherPlatforms = ['windows', 'windows-arm', 'mac-arm', 'mac-intel', 'linux-appimage', 'linux-deb'];
    }

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
    var tabTarget = isMac ? 'mac' : (primaryPlatform === 'windows-arm' ? 'windows' : primaryPlatform);
    var detectedTab = document.querySelector('[data-install-tab="' + tabTarget + '"]');
    if (detectedTab) detectedTab.click();

    fetch(LATEST_JSON_URL)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var version = data.version;
        if (versionEl) versionEl.textContent = 'Penpoint v' + version;

        if (primaryBtn) {
          if (isMac && macArch) {
            // Mac user with detected architecture: single primary button
            var detectedAvail = platformAvailable(data, macArch);
            if (detectedAvail) {
              primaryBtn.href = buildInstallerUrl(version, macArch);
              primaryBtn.innerHTML = '<i class="fa-brands fa-apple"></i>&ensp;Download for ' + platformLabel(macArch);
            } else {
              primaryBtn.textContent = 'macOS downloads unavailable';
              primaryBtn.classList.add('btn-disabled');
              primaryBtn.removeAttribute('href');
            }
          } else if (isMac) {
            // Mac user but couldn't detect architecture: show both buttons equally
            var macArmAvail = platformAvailable(data, 'mac-arm');
            var macIntelAvail = platformAvailable(data, 'mac-intel');

            if (macArmAvail || macIntelAvail) {
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
                buttonsHTML += '<a class="btn btn-primary btn-xl btn-shadow" href="' + buildInstallerUrl(version, 'mac-intel') + '">';
                buttonsHTML += '<i class="fa-brands fa-apple"></i>&ensp;Intel';
                buttonsHTML += '<span class="mac-arch-hint">2019 and earlier</span>';
                buttonsHTML += '</a>';
              }

              buttonsHTML += '</div>';
              buttonsHTML += '<span class="mac-arch-help font-body-sm">Not sure? Click \uf8ff → About This Mac</span>';
              buttonsHTML += '</div>';

              primaryBtn.outerHTML = buttonsHTML;
            } else {
              primaryBtn.textContent = 'macOS downloads unavailable';
              primaryBtn.classList.add('btn-disabled');
              primaryBtn.removeAttribute('href');
            }
          } else if (isLinux) {
            // Linux user: show both AppImage and Deb buttons
            var linuxAvail = platformAvailable(data, 'linux');

            if (linuxAvail) {
              var linuxHTML = '<div class="linux-format-buttons">';
              linuxHTML += '<span class="linux-format-label font-body">Choose your format:</span>';
              linuxHTML += '<div class="linux-format-options">';

              linuxHTML += '<a class="btn btn-primary btn-xl btn-shadow" href="' + buildInstallerUrl(version, 'linux-appimage') + '">';
              linuxHTML += '<i class="fa-brands fa-linux"></i>&ensp;AppImage';
              linuxHTML += '<span class="linux-format-hint">Universal, no install needed</span>';
              linuxHTML += '</a>';

              linuxHTML += '<a class="btn btn-primary btn-xl btn-shadow" href="' + buildInstallerUrl(version, 'linux-deb') + '">';
              linuxHTML += '<i class="fa-brands fa-linux"></i>&ensp;Deb Package';
              linuxHTML += '<span class="linux-format-hint">Debian, Ubuntu, Mint</span>';
              linuxHTML += '</a>';

              linuxHTML += '</div>';
              linuxHTML += '</div>';

              primaryBtn.outerHTML = linuxHTML;
            } else {
              primaryBtn.textContent = 'Linux downloads unavailable';
              primaryBtn.classList.add('btn-disabled');
              primaryBtn.removeAttribute('href');
            }
          } else {
            // Windows users: show single primary button
            var primaryAvail = platformAvailable(data, primaryPlatform);

            if (primaryAvail) {
              primaryBtn.href = buildInstallerUrl(version, primaryPlatform);
              primaryBtn.innerHTML = '<i class="' + platformIcon(primaryPlatform) + '"></i>&ensp;Download for ' + platformLabel(primaryPlatform);
            } else {
              primaryBtn.textContent = 'Downloads unavailable';
              primaryBtn.classList.add('btn-disabled');
              primaryBtn.removeAttribute('href');
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
          primaryBtn.textContent = 'Downloads temporarily unavailable';
          primaryBtn.classList.add('btn-disabled');
          primaryBtn.removeAttribute('href');
        }
        if (alsoContainer) alsoContainer.style.display = 'none';
        if (versionEl) versionEl.textContent = '';
      });
    }); // end armDetection.then
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
