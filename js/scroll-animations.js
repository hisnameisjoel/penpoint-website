/* ===========================================
   Penpoint Scroll Animation System
   Uses Intersection Observer API
   =========================================== */

(function() {
  'use strict';

  // ===========================================
  // SCROLL ANIMATION OBSERVER
  // ===========================================

  const animationObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Add the animate-in class to trigger CSS animation
        entry.target.classList.add('animate-in');

        // Optional: Unobserve after animation (prevents re-triggering)
        animationObserver.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,      // Trigger when 10% of element is visible
    rootMargin: '-50px'  // Offset from viewport edge
  });

  // Check if element is currently in viewport
  function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.top < window.innerHeight - 50 &&
      rect.bottom > 50
    );
  }

  // Observe all elements with data-animate attribute
  function initAnimations() {
    const animatedElements = document.querySelectorAll('[data-animate]');

    animatedElements.forEach(el => {
      if (isInViewport(el)) {
        // Still respect stagger delays for elements already in viewport
        const stagger = el.dataset.stagger;
        if (stagger) {
          const delay = parseInt(stagger) * 100;
          setTimeout(() => el.classList.add('animate-in'), delay);
        } else {
          el.classList.add('animate-in');
        }
      } else {
        animationObserver.observe(el);
      }
    });
  }

  // ===========================================
  // STAGGER ANIMATION HELPER
  // ===========================================

  // For groups of elements that should animate in sequence
  function initStaggerGroups() {
    const staggerGroups = document.querySelectorAll('[data-stagger-group]');

    staggerGroups.forEach(group => {
      const children = group.querySelectorAll('[data-animate]');
      const delay = parseInt(group.dataset.staggerDelay) || 100;

      children.forEach((child, index) => {
        child.style.animationDelay = `${index * delay}ms`;
      });
    });
  }

  // ===========================================
  // SMOOTH SCROLL FOR ANCHOR LINKS
  // ===========================================

  // Manual smooth scroll using requestAnimationFrame (more reliable)
  function smoothScrollTo(targetY, duration = 600) {
    const startY = window.pageYOffset;
    const difference = targetY - startY;
    const startTime = performance.now();

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function (ease-out cubic)
      const easeOut = 1 - Math.pow(1 - progress, 3);

      window.scrollTo(0, startY + difference * easeOut);

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const href = this.getAttribute('href');

        // Skip if just "#" (like logo link)
        if (!href || href === '#') {
          e.preventDefault();
          smoothScrollTo(0);
          return;
        }

        // Try to find the target element
        try {
          const target = document.querySelector(href);
          if (target) {
            e.preventDefault();
            const headerHeight = document.querySelector('.header')?.offsetHeight || 0;
            const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;

            smoothScrollTo(targetPosition);
          }
        } catch (err) {
          // Invalid selector, let default behavior happen
          console.warn('Invalid anchor selector:', href);
        }
      });
    });
  }

  // ===========================================
  // MOBILE MENU TOGGLE
  // ===========================================

  function initMobileMenu() {
    const menuBtn = document.querySelector('.header__menu-btn');
    const nav = document.querySelector('.header__nav');

    if (!menuBtn || !nav) return;

    menuBtn.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('header__nav--open');
      menuBtn.classList.toggle('header__menu-btn--active');
      menuBtn.setAttribute('aria-expanded', isOpen);
    });

    // Close menu when a nav link is clicked
    nav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        nav.classList.remove('header__nav--open');
        menuBtn.classList.remove('header__menu-btn--active');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ===========================================
  // INITIALIZATION
  // ===========================================

  function init() {
    // Wait for DOM to be fully loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDOMReady);
    } else {
      onDOMReady();
    }
  }

  function onDOMReady() {
    // Set up stagger delays FIRST (before triggering any animations)
    initStaggerGroups();
    // Then initialize scroll animations
    initAnimations();
    initSmoothScroll();
    initMobileMenu();

  }

  // Start initialization
  init();

})();
