/* ===========================================
   Penpoint Hero Text Rotation
   Cycles through pain point headlines
   =========================================== */

(function() {
  'use strict';

  const heroLines = [
    '"Was his name Aldric or Aldrick?"',
    '"I know I wrote this down somewhere."',
    '"Wait, did they already meet?"',
    '"My Google Doc is 47 pages of chaos."',
    '"I spelled it three different ways now I have to fix it."',
    '"Which chapter did she learn the secret?"',
    '"I need to find that scene where—never mind."'
  ];

  // Timing configuration (in milliseconds)
  const CONFIG = {
    firstHoldDuration: 7000, // Total time first line is visible before fading
    holdDuration: 5000,      // Total time each subsequent line is visible before fading
    fadeDuration: 600        // How long the fade animation takes (must match CSS)
  };

  let currentIndex = 0;
  let textElement = null;

  function clearAnimations() {
    if (!textElement) return;
    textElement.classList.remove('hero-rotate--fading-out', 'hero-rotate--fading-in');
  }

  function fadeOut() {
    if (!textElement) return;
    clearAnimations();
    // Force reflow to restart animation
    void textElement.offsetWidth;
    textElement.classList.add('hero-rotate--fading-out');
  }

  function fadeIn() {
    if (!textElement) return;
    clearAnimations();
    // Force reflow to restart animation
    void textElement.offsetWidth;
    textElement.classList.add('hero-rotate--fading-in');
  }

  function updateText() {
    if (!textElement) return;
    currentIndex = (currentIndex + 1) % heroLines.length;
    textElement.textContent = heroLines[currentIndex];
  }

  function rotateText() {
    // Fade out current text
    fadeOut();

    // After fade out completes, swap text and fade in
    setTimeout(() => {
      updateText();
      fadeIn();
    }, CONFIG.fadeDuration);

    // Schedule next rotation (fade out + fade in + hold)
    // Total time = fadeDuration (out) + fadeDuration (in) + holdDuration = ~6.2s per line
    setTimeout(rotateText, CONFIG.fadeDuration + CONFIG.fadeDuration + CONFIG.holdDuration);
  }

  function init() {
    textElement = document.querySelector('.hero-rotate__text');

    if (!textElement) {
      console.warn('Hero rotation: .hero-rotate__text element not found');
      return;
    }

    // Start the first rotation after the first line has been visible
    setTimeout(rotateText, CONFIG.firstHoldDuration);

    console.log('Hero text rotation ready');
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
