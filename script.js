/* ==========================================================================
   THE HORSESHOE DISTRICT — scroll choreography
   - Three.js: single hero scene (textured plane, mouse parallax, push-in)
   - GSAP + ScrollTrigger: pinned hero, word reveals, counters, pins,
     clip-path image wipes, horizontal phasing timeline
   - Respects prefers-reduced-motion throughout
   ========================================================================== */

import * as THREE from 'three';

gsap.registerPlugin(ScrollTrigger);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --------------------------------------------------------------------------
   THREE.JS HERO
   One scene, one plane, one texture. The camera stays put; we move/scale
   the plane (cheaper to reason about for "cover" fitting).
   -------------------------------------------------------------------------- */

const heroState = {
  renderer: null,
  scene: null,
  camera: null,
  plane: null,
  texture: null,
  raf: null,
  mouse: { x: 0, y: 0 },        // target (from pointer)
  eased: { x: 0, y: 0 },        // lerped value actually applied
  scrollZoom: 0,                // 0→1, driven by the pinned hero ScrollTrigger
  imgAspect: 800 / 355,         // overwritten once the texture loads
};

function initHero() {
  const mount = document.getElementById('hero-canvas');
  const fallback = document.getElementById('hero-fallback');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch (e) {
    return; // no WebGL — the <img> fallback stays visible
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1A1A1A');

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 10;

  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const plane = new THREE.Mesh(geometry, material);
  scene.add(plane);

  Object.assign(heroState, { renderer, scene, camera, plane });

  const loader = new THREE.TextureLoader();
  // Try .jpg first, fall back to .png — whichever was dropped into /images
  const tryLoadTexture = (candidates) => {
    if (candidates.length === 0) {
      mount.style.display = 'none'; // no image yet — keep the <img> fallback
      return;
    }
    loader.load(
      candidates[0],
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        heroState.texture = texture;
        heroState.imgAspect = texture.image.width / texture.image.height;
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        fitPlane();
        fallback.style.display = 'none'; // scene is live; drop the static image
        if (reducedMotion) renderHeroFrame(); // single static frame, no loop
      },
      undefined,
      () => tryLoadTexture(candidates.slice(1))
    );
  };
  tryLoadTexture(['images/hero-district.jpg', 'images/hero-district.png']);

  fitPlane();

  // Mouse parallax (desktop pointers only; skipped for reduced motion)
  if (!reducedMotion) {
    window.addEventListener('pointermove', (e) => {
      heroState.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      heroState.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    startHeroLoop();
  } else {
    renderHeroFrame();
  }

  window.addEventListener('resize', onHeroResize);
  window.addEventListener('pagehide', disposeHero, { once: true });
}

/* Size the plane so the image covers the viewport (CSS object-fit: cover
   semantics) with a margin so parallax/zoom never reveals edges. */
function fitPlane() {
  const { camera, plane, imgAspect } = heroState;
  if (!plane) return;

  const dist = camera.position.z;
  const viewH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const viewW = viewH * camera.aspect;

  let w, h;
  if (viewW / viewH > imgAspect) {
    w = viewW; h = viewW / imgAspect;
  } else {
    h = viewH; w = viewH * imgAspect;
  }

  const MARGIN = 1.12; // headroom for parallax drift + push-in
  plane.scale.set(w * MARGIN, h * MARGIN, 1);
  plane.userData.baseScale = { x: plane.scale.x, y: plane.scale.y };
}

function startHeroLoop() {
  const clock = new THREE.Clock();

  const tick = () => {
    const { plane, eased, mouse, scrollZoom } = heroState;
    const t = clock.getElapsedTime();

    // Lerp the pointer for a weighted, cinematic feel
    eased.x += (mouse.x - eased.x) * 0.04;
    eased.y += (mouse.y - eased.y) * 0.04;

    // Slow idle push-in (eases toward +6% over ~30s), plus the scroll-driven
    // push from the pinned hero (up to a further +14%)
    const idle = 1 + 0.06 * (1 - Math.exp(-t / 12));
    const push = idle + scrollZoom * 0.14;

    plane.position.x = -eased.x * 0.22;
    plane.position.y = eased.y * 0.16;
    plane.rotation.y = -eased.x * 0.012;
    plane.rotation.x = eased.y * 0.008;

    // Apply push on top of the cover-fit scale (set by fitPlane)
    const base = plane.userData.baseScale;
    plane.scale.set(base.x * push, base.y * push, 1);

    renderHeroFrame();
    heroState.raf = requestAnimationFrame(tick);
  };

  heroState.raf = requestAnimationFrame(tick);
}

function renderHeroFrame() {
  const { renderer, scene, camera } = heroState;
  if (renderer) renderer.render(scene, camera);
}

function onHeroResize() {
  const { renderer, camera } = heroState;
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitPlane();
  if (reducedMotion) renderHeroFrame();
}

function disposeHero() {
  const { renderer, plane, texture, raf } = heroState;
  if (raf) cancelAnimationFrame(raf);
  if (texture) texture.dispose();
  if (plane) { plane.geometry.dispose(); plane.material.dispose(); }
  if (renderer) renderer.dispose();
}

initHero();

/* --------------------------------------------------------------------------
   WORD SPLITTER — wraps each word of [data-split] elements in a span
   so GSAP can reveal them one-by-one.
   -------------------------------------------------------------------------- */

function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  el.setAttribute('aria-label', words.join(' '));
  words.forEach((word, i) => {
    const span = document.createElement('span');
    span.className = 'split-word';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = word + (i < words.length - 1 ? ' ' : '');
    el.appendChild(span);
  });
  return el.querySelectorAll('.split-word');
}

/* --------------------------------------------------------------------------
   IMAGE FALLBACKS — every site image is referenced as .jpg; if that 404s
   we retry once with .png (so either extension works in /images). If a
   precinct render is missing in both formats, show a "coming soon" tile.
   -------------------------------------------------------------------------- */

document.querySelectorAll('main img, .hero-fallback').forEach((img) => {
  img.addEventListener('error', () => {
    if (!img.dataset.retriedExt) {
      img.dataset.retriedExt = 'true';
      img.src = img.src.endsWith('.png')
        ? img.src.replace(/\.png$/, '.jpg')
        : img.src.replace(/\.jpg$/, '.png');
      return;
    }
    const wrap = img.closest('.precinct-media');
    if (wrap) {
      wrap.classList.add('is-placeholder');
      wrap.dataset.title = img.dataset.placeholderTitle || 'Precinct';
      img.remove();
    }
  });
});

/* --------------------------------------------------------------------------
   HERO WATERMARK — if a logo has been dropped into /images (block-o.svg,
   .png, or .jpg), swap it in for the stylized inline SVG.
   -------------------------------------------------------------------------- */

(function loadWatermark(candidates) {
  if (candidates.length === 0) return; // none uploaded — keep the inline SVG
  const probe = new Image();
  probe.onload = () => {
    const img = document.querySelector('.hero-watermark-img');
    img.src = probe.src;
    img.hidden = false;
    document.querySelector('svg.hero-watermark').remove();
  };
  probe.onerror = () => loadWatermark(candidates.slice(1));
  probe.src = candidates[0];
})(['images/block-o.svg', 'images/block-o.png', 'images/block-o.jpg']);

/* --------------------------------------------------------------------------
   SCROLL CHOREOGRAPHY
   Content is visible by default (we only use gsap.from), so a JS failure
   or reduced-motion preference still leaves a fully readable page.
   -------------------------------------------------------------------------- */

// Nav appears once the hero is left behind — works in all motion modes
ScrollTrigger.create({
  trigger: '#vision',
  start: 'top 75%',
  onEnter: () => document.getElementById('site-nav').classList.add('is-visible'),
  onLeaveBack: () => document.getElementById('site-nav').classList.remove('is-visible'),
});

if (reducedMotion) {
  // No animation: just render final numbers for the counters
  document.querySelectorAll('.stat-number').forEach((el) => {
    el.textContent = formatStat(Number(el.dataset.target), el);
  });
} else {
  initAnimations();
}

function formatStat(value, el) {
  const decimals = Number(el.dataset.decimals || 0);
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (el.dataset.prefix || '') + formatted + (el.dataset.suffix || '');
}

function initAnimations() {
  const EASE = 'power3.out';

  /* --- Hero: pin, fade the overlay out, push the camera in on scrub ----- */
  gsap.timeline({
    scrollTrigger: {
      trigger: '#hero',
      start: 'top top',
      end: '+=80%',
      pin: true,
      scrub: 0.6,
      // Feed scroll progress to the Three.js loop for the camera push
      onUpdate: (self) => { heroState.scrollZoom = self.progress; },
    },
  })
    .to('#hero-overlay', { autoAlpha: 0, y: -40, ease: 'none' }, 0)
    .to('#scroll-cue', { autoAlpha: 0, ease: 'none' }, 0);

  // Fade the hero headline in on load (watermark fades separately —
  // animating its y would fight the CSS transform that centers it)
  gsap.from('#hero-overlay > :not(.hero-watermark)', {
    autoAlpha: 0, y: 30, duration: 1.2, ease: EASE, stagger: 0.15, delay: 0.4,
  });
  gsap.from('.hero-watermark', { opacity: 0, duration: 2, delay: 0.2 });
  gsap.from('#scroll-cue', { autoAlpha: 0, duration: 1, delay: 1.6 });

  /* --- Generic one-shot reveals ([data-reveal]) ------------------------- */
  document.querySelectorAll('[data-reveal]').forEach((el) => {
    gsap.from(el, {
      autoAlpha: 0,
      y: 36,
      duration: 0.9,
      ease: EASE,
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    });
  });

  /* --- Vision + closing line: word-by-word reveal ----------------------- */
  document.querySelectorAll('[data-split]').forEach((el) => {
    const words = splitWords(el);
    gsap.from(words, {
      autoAlpha: 0,
      yPercent: 70,
      duration: 0.6,
      ease: EASE,
      stagger: 0.045,
      scrollTrigger: { trigger: el, start: 'top 78%', once: true },
    });
  });

  /* --- Stat counters ----------------------------------------------------- */
  document.querySelectorAll('.stat-number').forEach((el) => {
    const target = Number(el.dataset.target);
    const counter = { value: 0 };
    gsap.to(counter, {
      value: target,
      duration: 1.8,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
      onUpdate: () => { el.textContent = formatStat(Math.round(counter.value), el); },
    });
  });

  /* --- Master plan pins: sequenced entrance ------------------------------ */
  gsap.from('.masterplan-stage .pin', {
    autoAlpha: 0,
    y: 14,
    scale: 0.85,
    transformOrigin: 'left center',
    duration: 0.55,
    ease: 'back.out(1.6)',
    stagger: 0.3,
    scrollTrigger: { trigger: '.masterplan-stage', start: 'top 60%', once: true },
  });

  /* --- Precinct media: clip-path wipe + gentle parallax ------------------ */
  document.querySelectorAll('[data-clip]').forEach((media) => {
    const fromRight = media.closest('.precinct-flip') !== null;
    gsap.fromTo(media,
      { clipPath: fromRight ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' },
      {
        clipPath: 'inset(0 0% 0 0%)',
        duration: 1.1,
        ease: 'power4.inOut',
        scrollTrigger: { trigger: media, start: 'top 75%', once: true },
      }
    );

    const img = media.querySelector('img');
    if (img) {
      gsap.fromTo(img,
        { yPercent: -6, scale: 1.12 },
        {
          yPercent: 6,
          scale: 1.12,
          ease: 'none',
          scrollTrigger: { trigger: media, start: 'top bottom', end: 'bottom top', scrub: true },
        }
      );
    }
  });

  /* --- Phasing: horizontal pinned scroll (desktop only) ------------------ */
  const mm = gsap.matchMedia();
  mm.add('(min-width: 861px)', () => {
    const track = document.getElementById('phase-track');
    const pinWrap = document.getElementById('phasing-pin');
    const distance = () => track.scrollWidth - window.innerWidth;

    const tween = gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: {
        trigger: '#phasing',
        start: 'top top',
        end: () => '+=' + distance(),
        pin: pinWrap,
        scrub: 0.8,
        invalidateOnRefresh: true,
      },
    });

    return () => tween.scrollTrigger?.kill(); // matchMedia cleanup
  });

  /* --- Closing: slow drift on the darkened hero -------------------------- */
  gsap.fromTo('.closing-bg',
    { scale: 1.12 },
    {
      scale: 1,
      ease: 'none',
      scrollTrigger: { trigger: '.closing', start: 'top bottom', end: 'bottom bottom', scrub: true },
    }
  );
}
