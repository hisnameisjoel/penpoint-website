/* ===========================================
   Penpoint Lightbox System
   Simple, accessible lightbox for feature previews
   =========================================== */

(function() {
  'use strict';

  // ===========================================
  // LIGHTBOX CONTROLLER
  // ===========================================

  const lightbox = {
    element: null,
    titleEl: null,
    descEl: null,
    isOpen: false,

    init() {
      this.element = document.getElementById('lightbox');
      if (!this.element) return;

      this.titleEl = this.element.querySelector('.lightbox__title');
      this.descEl = this.element.querySelector('.lightbox__desc');

      this.bindEvents();
    },

    bindEvents() {
      // Open lightbox when clicking feature image buttons
      document.querySelectorAll('[data-lightbox]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const title = btn.dataset.lightboxTitle || '';
          const desc = btn.dataset.lightboxDesc || '';
          this.open(title, desc);
        });
      });

      // Close button
      const closeBtn = this.element.querySelector('.lightbox__close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.close());
      }

      // Close on overlay click
      const overlay = this.element.querySelector('.lightbox__overlay');
      if (overlay) {
        overlay.addEventListener('click', () => this.close());
      }

      // Close on Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
        }
      });
    },

    open(title, desc) {
      if (!this.element) return;

      // Update content
      if (this.titleEl) this.titleEl.textContent = title;
      if (this.descEl) this.descEl.textContent = desc;

      // Show lightbox
      this.element.classList.add('lightbox--open');
      this.element.setAttribute('aria-hidden', 'false');
      document.body.classList.add('lightbox-open');
      this.isOpen = true;

      // Focus the close button for accessibility
      const closeBtn = this.element.querySelector('.lightbox__close');
      if (closeBtn) {
        setTimeout(() => closeBtn.focus(), 100);
      }
    },

    close() {
      if (!this.element) return;

      this.element.classList.remove('lightbox--open');
      this.element.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lightbox-open');
      this.isOpen = false;
    }
  };

  // ===========================================
  // INITIALIZATION
  // ===========================================

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => lightbox.init());
    } else {
      lightbox.init();
    }
  }

  init();

})();
