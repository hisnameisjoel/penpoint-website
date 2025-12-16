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
      // Immediately animate elements already in viewport
      if (isInViewport(el)) {
        el.classList.add('animate-in');
      } else {
        // Only observe elements not yet visible
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
  // HEADER SCROLL BEHAVIOR
  // ===========================================

  function initHeaderScroll() {
    const header = document.querySelector('.header');
    if (!header) return;

    let lastScroll = 0;
    const scrollThreshold = 100;

    window.addEventListener('scroll', () => {
      const currentScroll = window.pageYOffset;

      // Add/remove solid background based on scroll position
      if (currentScroll > scrollThreshold) {
        header.classList.remove('header--transparent');
        header.classList.add('header--solid');
      } else {
        header.classList.remove('header--solid');
        header.classList.add('header--transparent');
      }

      lastScroll = currentScroll;
    }, { passive: true });
  }

  // ===========================================
  // SMOOTH SCROLL FOR ANCHOR LINKS
  // ===========================================

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));

        if (target) {
          const headerHeight = document.querySelector('.header')?.offsetHeight || 0;
          const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;

          window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
          });
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
    initHeaderScroll();
    initSmoothScroll();
    initMobileMenu();

    // Log initialization (minimal)
    console.log('Penpoint animations ready');
  }

  // Start initialization
  init();

})();
