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
    imageWrapper: null,
    isOpen: false,
    triggerElement: null, // Store the element that opened the lightbox
    imageEl: null, // Reusable image element
    placeholderEl: null, // Reusable placeholder element

    init() {
      this.element = document.getElementById('lightbox');
      if (!this.element) return;

      this.titleEl = this.element.querySelector('.lightbox__title');
      this.descEl = this.element.querySelector('.lightbox__desc');
      this.imageWrapper = this.element.querySelector('.lightbox__image-wrapper');

      // Create reusable image element
      this.imageEl = document.createElement('img');
      this.imageEl.className = 'lightbox__image';

      // Store reference to placeholder
      this.placeholderEl = this.imageWrapper.querySelector('.lightbox__image-placeholder');

      this.bindEvents();
    },

    bindEvents() {
      // Open lightbox when clicking feature image buttons
      document.querySelectorAll('[data-lightbox]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const title = btn.dataset.lightboxTitle || '';
          const desc = btn.dataset.lightboxDesc || '';
          const image = btn.dataset.lightboxImage || '';
          this.open(title, desc, image, btn);
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

      // Keyboard handling: Escape to close, Tab to trap focus
      document.addEventListener('keydown', (e) => {
        if (!this.isOpen) return;

        if (e.key === 'Escape') {
          this.close();
        } else if (e.key === 'Tab') {
          this.trapFocus(e);
        }
      });
    },

    trapFocus(e) {
      const focusableElements = this.element.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab: if on first element, go to last
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        // Tab: if on last element, go to first
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    },

    open(title, desc, imageSrc, triggerEl) {
      if (!this.element) return;

      // Store trigger element to return focus on close
      this.triggerElement = triggerEl || null;

      // Update content using textContent (safe)
      if (this.titleEl) this.titleEl.textContent = title;
      if (this.descEl) this.descEl.textContent = desc;

      // Update image using DOM methods (not innerHTML)
      if (this.imageWrapper) {
        if (imageSrc) {
          // Show actual image - use setAttribute for safety
          this.imageEl.setAttribute('src', imageSrc);
          this.imageEl.setAttribute('alt', title);

          // Clear wrapper and append image
          if (this.placeholderEl && this.placeholderEl.parentNode === this.imageWrapper) {
            this.imageWrapper.removeChild(this.placeholderEl);
          }
          if (this.imageEl.parentNode !== this.imageWrapper) {
            this.imageWrapper.appendChild(this.imageEl);
          }
        } else {
          // Show placeholder
          if (this.imageEl.parentNode === this.imageWrapper) {
            this.imageWrapper.removeChild(this.imageEl);
          }
          if (this.placeholderEl && this.placeholderEl.parentNode !== this.imageWrapper) {
            this.imageWrapper.appendChild(this.placeholderEl);
          }
        }
      }

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

      // Return focus to trigger element
      if (this.triggerElement) {
        this.triggerElement.focus();
        this.triggerElement = null;
      }
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
