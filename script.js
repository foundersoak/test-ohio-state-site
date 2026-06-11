/* ==========================================================================
   THE HORSESHOE DISTRICT - scroll choreography
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
    return; // no WebGL - the <img> fallback stays visible
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
  // Try .jpg first, fall back to .png - whichever was dropped into /images
  const tryLoadTexture = (candidates) => {
    if (candidates.length === 0) {
      mount.style.display = 'none'; // no image yet - keep the <img> fallback
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
   WORD SPLITTER - wraps each word of [data-split] elements in a span
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
   IMAGE FALLBACKS - site images are referenced as .jpg; if that 404s we
   retry once with .png so either extension works in /images. (The zoom
   detail card handles its own image fallback in initPlanZoom.)
   -------------------------------------------------------------------------- */

document.querySelectorAll('.masterplan-stage > img, .closing-bg, .hero-fallback').forEach((img) => {
  img.addEventListener('error', () => {
    if (!img.dataset.retriedExt) {
      img.dataset.retriedExt = 'true';
      img.src = img.src.endsWith('.png')
        ? img.src.replace(/\.png$/, '.jpg')
        : img.src.replace(/\.jpg$/, '.png');
    }
  });
});

/* --------------------------------------------------------------------------
   VISION WATERMARK - if a logo has been dropped into /images (block-o.svg,
   .png, or .jpg), swap it in for the stylized inline SVG.
   -------------------------------------------------------------------------- */

(function loadWatermark(candidates) {
  if (candidates.length === 0) return; // none uploaded - keep the inline SVG
  const probe = new Image();
  probe.onload = () => {
    const img = document.querySelector('.vision-watermark-img');
    img.src = probe.src;
    img.hidden = false;
    document.querySelector('svg.vision-watermark').remove();
  };
  probe.onerror = () => loadWatermark(candidates.slice(1));
  probe.src = candidates[0];
})(['images/block-o.svg', 'images/block-o.png', 'images/block-o.jpg']);

/* --------------------------------------------------------------------------
   MASTER PLAN CLICK-TO-ZOOM
   Clicking a pin zooms the aerial toward that precinct and slides in a
   detail card with that precinct's render, story, and revenue line. ESC,
   the close button, or the dimmed backdrop zooms back out.
   EDIT: precinct copy lives in the PRECINCTS object below.
   -------------------------------------------------------------------------- */

const PRECINCTS = {
  amphitheater: {
    eyebrow: 'Precinct 01',
    title: 'The Amphitheater',
    copy: "A 4,300-seat open-air venue under a white tensile roof, with the Horseshoe itself as the backdrop. Concerts, commencements, watch parties, and community events, programmed year-round to anchor the district's nightlife and give Columbus a stage it doesn't have.",
    value: 'Athletics upside: ticketing share · naming rights · sponsorship · food and beverage',
    image: 'images/amphitheater.jpg',
  },
  'scarlet-spine': {
    eyebrow: 'Precinct 02',
    title: 'The Scarlet Spine',
    copy: 'A pedestrian retail promenade running on a straight axis to the stadium gates: restaurants, flagship retail, and Buckeye-first storefronts that turn the walk to the game into the destination itself.',
    value: 'Athletics upside: retail leases · flagship team store · brand activations',
    image: 'images/scarlet-spine.jpg',
  },
  hotel: {
    eyebrow: 'Precinct 03',
    title: 'Buckeye Tower',
    copy: "A full-service hotel and conference venue overlooking the stadium, serving recruits' families, visiting teams, alumni weekends, and the university's year-round events calendar.",
    value: 'Athletics upside: ground lease participation · recruiting hospitality · naming partner',
    image: 'images/hotel-tower.jpg',
  },
  riverfront: {
    eyebrow: 'Precinct 04',
    title: 'The Riverfront',
    copy: 'The Olentangy edge, opened up: a landscaped promenade, terraced steps to the water, a signature pedestrian bridge, and parkland on the far bank that ties the district to the river.',
    value: 'Civic upside: public space · trail connections · land value uplift',
    image: 'images/riverfront.jpg',
  },
  residential: {
    eyebrow: 'Precinct 05',
    title: 'Residential Towers',
    copy: "Market-rate and graduate residences with stadium views: a built-in population that keeps the district's restaurants, shops, and riverfront busy every day of the year.",
    value: 'University upside: ground lease income · year-round district population',
    image: 'images/residential.jpg',
  },
};

(function initPlanZoom() {
  const stage = document.querySelector('.masterplan-stage');
  const img = stage.querySelector('img');
  const dim = stage.querySelector('.plan-dim');
  const pins = gsap.utils.toArray(stage.querySelectorAll('.pin'));
  const card = document.getElementById('plan-detail');
  const field = (sel) => card.querySelector(sel);

  const speed = reducedMotion ? 0 : 1; // collapse animation under reduced motion
  let openPin = null;

  function open(pin) {
    const data = PRECINCTS[pin.dataset.precinct];
    if (!data) return;

    field('.plan-detail-eyebrow').textContent = data.eyebrow;
    field('.plan-detail-title').textContent = data.title;
    field('.plan-detail-copy').textContent = data.copy;
    field('.plan-detail-value').textContent = data.value;

    openPin = pin;
    stage.classList.add('is-zoomed');
    card.hidden = false;

    /* Frame the precinct rather than the pin: scale plus translate so the
       focus point lands in the area the detail card leaves clear. Focus
       defaults to the pin position; override per pin with data-fx / data-fy
       (percent coordinates of the precinct's visual center) and data-zoom.
       The card sits opposite the precinct so it never covers it. */
    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    const zoom = Number(pin.dataset.zoom) || (isMobile ? 1.5 : 1.8);
    const rect = stage.getBoundingClientRect();
    const fx = (parseFloat(pin.dataset.fx) || parseFloat(pin.style.getPropertyValue('--x'))) / 100;
    const fy = (parseFloat(pin.dataset.fy) || parseFloat(pin.style.getPropertyValue('--y'))) / 100;
    const cardOnLeft = !isMobile && fx > 0.5;
    card.classList.toggle('plan-detail-left', cardOnLeft);
    const targetX = isMobile ? 0.5 : (cardOnLeft ? 0.64 : 0.36);
    const targetY = isMobile ? 0.4 : 0.5;   // bottom sheet covers the lower part on mobile
    // Clamp the translate so the scaled image never reveals its edges
    const x = gsap.utils.clamp(rect.width * (1 - zoom), 0, (targetX - fx * zoom) * rect.width);
    const y = gsap.utils.clamp(rect.height * (1 - zoom), 0, (targetY - fy * zoom) * rect.height);

    // Spotlight: the dim layer gets a clear radial hole over the precinct's
    // final on-screen position, so the selection stays lit while the rest
    // of the plan falls dark
    const sx = (fx * zoom + x / rect.width) * 100;
    const sy = (fy * zoom + y / rect.height) * 100;
    dim.style.background =
      `radial-gradient(circle at ${sx}% ${sy}%, ` +
      'rgba(26, 26, 26, 0) 0%, rgba(26, 26, 26, 0.02) 16%, ' +
      'rgba(26, 26, 26, 0.38) 38%, rgba(26, 26, 26, 0.66) 60%)';

    gsap.set(img, { transformOrigin: '0 0' });
    gsap.timeline({ defaults: { ease: 'power3.inOut' } })
      .to(pins, { autoAlpha: 0, duration: 0.25 * speed }, 0)
      .to(img, { scale: zoom, x, y, duration: 0.9 * speed }, 0)
      .to(dim, { autoAlpha: 1, duration: 0.7 * speed }, 0.1 * speed)
      .fromTo(card, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5 * speed }, 0.35 * speed);

    field('.plan-detail-close').focus();
  }

  function close() {
    if (!openPin) return;
    const pin = openPin;
    openPin = null;

    gsap.timeline({
      defaults: { ease: 'power3.inOut' },
      onComplete: () => {
        card.hidden = true;
        stage.classList.remove('is-zoomed');
        pin.focus();
      },
    })
      .to(card, { autoAlpha: 0, y: 24, duration: 0.3 * speed }, 0)
      .to(img, { scale: 1, x: 0, y: 0, duration: 0.8 * speed }, 0)
      .to(dim, { autoAlpha: 0, duration: 0.6 * speed }, 0)
      .to(pins, { autoAlpha: 1, duration: 0.35 * speed }, 0.3 * speed);
  }

  pins.forEach((pin) => pin.addEventListener('click', () => {
    openPin ? close() : open(pin);
  }));

  field('.plan-detail-close').addEventListener('click', close);
  dim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();

/* --------------------------------------------------------------------------
   SCROLL CHOREOGRAPHY
   Content is visible by default (we only use gsap.from), so a JS failure
   or reduced-motion preference still leaves a fully readable page.
   -------------------------------------------------------------------------- */

// Nav appears once the hero is left behind - works in all motion modes
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

  // Fade the hero headline in on load
  gsap.from('#hero-overlay > *', {
    autoAlpha: 0, y: 30, duration: 1.2, ease: EASE, stagger: 0.15, delay: 0.4,
  });

  // Vision watermark: slow vertical drift as the section scrolls through.
  // The CSS centering transform is translateY(-50%); GSAP folds that into
  // yPercent, so we drift around it.
  gsap.fromTo('.vision-watermark',
    { yPercent: -58 },
    {
      yPercent: -42,
      ease: 'none',
      scrollTrigger: { trigger: '.vision', start: 'top bottom', end: 'bottom top', scrub: true },
    }
  );
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
