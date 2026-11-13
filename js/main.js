/* ============================================================================
   重庆移通学院 · 招生宣传概念站
   交互脚本 / 原生 JavaScript（无框架、无构建依赖）
   ----------------------------------------------------------------------------
   功能一览
   01. 通用工具与运行环境
   02. 图片插槽加载检测
   03. 固定导航、滚动进度与返回顶部
   04. 导航高亮（Scroll Spy）
   05. 移动端导航
   06. 通用滚动入场动画（IntersectionObserver）
   07. 数据数字滚动计数
   08. Hero 视差滚动
   09. 光标微光与卡片光晕
   10. 初始化调度

   性能约定
   · 所有 scroll / pointermove 均使用 requestAnimationFrame 合并刷新；
   · 滚动监听统一加上 passive: true；
   · 入场与计数观察器在触发后立即 unobserve；
   · 当用户系统设置“减少动态效果”时，全部动画降级为静态结果。
   ========================================================================== */

(function () {
  'use strict';

  /* ==========================================================================
     01. 通用工具与运行环境
     ========================================================================== */
  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => Array.from(context.querySelectorAll(selector));
  const root = document.documentElement;
  const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktopPointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const desktopLayoutQuery = window.matchMedia('(min-width: 721px)');

  // 各模块注册到统一的滚动帧里，避免重复创建 scroll 监听器。
  const scrollTasks = [];

  const prefersReducedMotion = () => reduceMotionQuery.matches;
  const raf = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(callback, 16);

  /**
   * 数字格式化：站点使用无千分位的硬朗数字风格。
   * 如需改为 41,000，可把此函数的实现替换为 value.toLocaleString('en-US')。
   * @param {number} value
   * @returns {string}
   */
  const formatMetric = (value) => String(Math.round(value));

  /**
   * 三次缓出：让计数动画尾段自然减速。
   * @param {number} progress 0—1
   * @returns {number}
   */
  const easeOutCubic = (progress) => 1 - Math.pow(1 - progress, 3);

  /* ==========================================================================
     02. 图片插槽加载检测
     图片成功加载后为 .img-slot 添加 .is-loaded，CSS 自动隐藏占位提示并淡入图片。
     图片缺失 / 路径错误时保留占位层，因此双击运行也不会出现布局塌陷。
     ========================================================================== */
  function initImageSlots() {
    $$('.img-slot').forEach((slot) => {
      // 只处理插槽直接持有的图片；学校概况轮播的图片由内部每个 slide 自己管理。
      const image = slot.querySelector(':scope > .img-slot__img');
      if (!image) return;

      const markLoaded = () => {
        if (!image.naturalWidth) return;
        slot.classList.add('is-loaded');
        slot.classList.remove('is-error');
      };

      const markError = () => {
        slot.classList.add('is-error');
        slot.classList.remove('is-loaded');
      };

      // 脚本执行前已缓存完成的图片不会再次触发 load，需主动判断一次。
      if (image.complete) {
        if (image.naturalWidth > 0) {
          markLoaded();
        } else {
          markError();
        }
      }

      image.addEventListener('load', markLoaded, { once: true });
      image.addEventListener('error', markError, { once: true });
    });
  }

  /* ==========================================================================
     02.5 全屏加载遮罩
     环形进度与页面资源加载状态绑定，同时保证开场动画有可感知的节奏。
     完成前不可跳过；完成后点击任意位置进入，1.5s 未操作自动退场。
     ========================================================================== */
  function initPageLoader() {
    const loader = $('[data-loader]');
    if (!loader) {
      root.classList.add('hero-ambient-ready', 'hero-ready');
      document.body.classList.remove('is-loading');
      return;
    }

    const ring = $('[data-loader-ring]', loader);
    const percentText = $('[data-loader-percent]', loader);
    const progressbar = $('[data-loader-progressbar]', loader);
    const statusText = $('[data-loader-status]', loader);
    const prompt = $('[data-loader-prompt]', loader);
    const logo = $('[data-loader-logo]', loader);
    const logoImage = $('[data-loader-logo-img]', loader);

    if (logo && logoImage) {
      const markLogoLoaded = () => {
        if (logoImage.naturalWidth > 0) {
          logo.classList.add('is-loaded');
        }
      };

      if (logoImage.complete) {
        markLogoLoaded();
      } else {
        logoImage.addEventListener('load', markLogoLoaded, { once: true });
      }
    }

    const state = {
      ready: false,
      exiting: false,
      frame: 0,
      progress: 0,
      resourcesReady: false,
      finalStartedAt: null
    };

    const setProgress = (value) => {
      const next = Math.min(1, Math.max(0, value));
      state.progress = Math.max(state.progress, next);

      if (ring) {
        ring.style.strokeDashoffset = String(100 - state.progress * 100);
      }

      const percent = Math.round(state.progress * 100);
      if (percentText && percentText.textContent !== String(percent)) {
        percentText.textContent = String(percent);
      }
      if (progressbar) {
        progressbar.setAttribute('aria-valuenow', String(percent));
      }
    };

    let autoTimer = 0;
    let resourceTimeout = 0;

    const handleEnter = () => {
      if (!state.ready || state.exiting) return;
      beginExit();
    };

    const handleKeydown = (event) => {
      if (!state.ready || state.exiting) return;
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault();
      beginExit();
    };

    const finishExit = () => {
      loader.hidden = true;
      document.body.classList.remove('is-loading');
      document.body.removeAttribute('aria-busy');
      root.classList.add('hero-ready');
    };

    const beginExit = () => {
      if (!state.ready || state.exiting) return;
      state.exiting = true;
      window.clearTimeout(autoTimer);
      document.removeEventListener('click', handleEnter);
      document.removeEventListener('keydown', handleKeydown);

      // 遮罩开始上收时，粒子与光晕先行淡入；文字则等遮罩完全隐藏后再进入。
      root.classList.add('hero-ambient-ready');
      loader.classList.add('is-leaving');
      loader.setAttribute('aria-hidden', 'true');

      window.setTimeout(
        finishExit,
        prefersReducedMotion() ? 0 : 630
      );
    };

    const markReady = () => {
      if (state.ready) return;
      state.ready = true;
      setProgress(1);
      loader.classList.add('is-ready');
      loader.setAttribute('aria-label', '页面加载完成，点击任意位置进入');
      if (statusText) statusText.textContent = 'READY / 校园信号已接入';
      if (prompt) prompt.setAttribute('aria-hidden', 'false');
      window.clearTimeout(resourceTimeout);

      document.body.setAttribute('aria-busy', 'false');
      document.addEventListener('click', handleEnter);
      document.addEventListener('keydown', handleKeydown);

      // 完成后给用户 1.5s 主动进入时间，未操作则自动退场。
      autoTimer = window.setTimeout(beginExit, 1500);
    };

    const handleResourcesReady = () => {
      state.resourcesReady = true;
      window.clearTimeout(resourceTimeout);
    };

    if (document.readyState === 'complete') {
      handleResourcesReady();
    } else {
      window.addEventListener('load', handleResourcesReady, { once: true });
    }

    // 极端网络下不让进度永久停在 90%：超时后允许正常收尾。
    resourceTimeout = window.setTimeout(handleResourcesReady, 8000);

    const minFillDuration = 900;
    const finalDuration = 300;
    const startedAt = performance.now();

    const tick = (now) => {
      if (state.ready || state.exiting) return;

      const elapsed = now - startedAt;
      if (!state.resourcesReady || elapsed < minFillDuration) {
        const softProgress = 0.02 + 0.88 * easeOutCubic(Math.min(1, elapsed / minFillDuration));
        setProgress(Math.min(0.9, softProgress));
      } else {
        if (state.finalStartedAt === null) state.finalStartedAt = now;
        const finalProgress = Math.min(1, (now - state.finalStartedAt) / finalDuration);
        const progress = 0.9 + 0.1 * easeOutCubic(finalProgress);
        setProgress(progress);

        if (progress >= 0.999) {
          markReady();
          return;
        }
      }

      state.frame = raf(tick);
    };

    document.body.setAttribute('aria-busy', 'true');
    setProgress(0);
    state.frame = raf(tick);
  }

  /* ==========================================================================
     02.7 学校概况实拍轮播
     可调参数：
     · 图片路径：assets/images/school/ 下的 12 张校园实拍图；
     · 自动轮播间隔：data-carousel-interval（默认 4000ms）；
     · 淡入淡出时长：data-carousel-fade（默认 600ms，同步到 CSS 变量）；
     · 悬停暂停、移出恢复，页面隐藏时暂停自动播放；
     · 图片暗色融合参数见 css/style.css 的 --overview-photo-* / --overview-mask-*。
     ========================================================================== */
  function initOverviewCarousel() {
    const carousel = $('[data-carousel]');
    if (!carousel) return;

    const slides = $$('[data-carousel-slide]', carousel);
    const indicators = $$('[data-carousel-target]', carousel);
    if (slides.length < 2) return;

    const autoInterval = Math.max(1000, Number(carousel.dataset.carouselInterval) || 4000);
    const fadeDuration = Math.max(0, Number(carousel.dataset.carouselFade) || 600);
    carousel.style.setProperty('--overview-carousel-fade', `${fadeDuration}ms`);

    let activeIndex = Math.max(
      0,
      slides.findIndex((slide) => slide.classList.contains('is-active'))
    );
    let autoTimer = 0;
    let hoverPaused = false;

    const canAutoPlay = () => !prefersReducedMotion();
    const isPaused = () => hoverPaused || document.hidden;

    const render = (nextIndex) => {
      activeIndex = ((nextIndex % slides.length) + slides.length) % slides.length;

      slides.forEach((slide, index) => {
        const isActive = index === activeIndex;
        slide.classList.toggle('is-active', isActive);
        slide.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      });

      indicators.forEach((indicator, index) => {
        const isActive = index === activeIndex;
        indicator.classList.toggle('is-active', isActive);
        if (isActive) {
          indicator.setAttribute('aria-current', 'true');
        } else {
          indicator.removeAttribute('aria-current');
        }
      });
    };

    const stopAutoPlay = () => {
      if (!autoTimer) return;
      window.clearInterval(autoTimer);
      autoTimer = 0;
    };

    const startAutoPlay = () => {
      stopAutoPlay();
      if (!canAutoPlay() || isPaused()) return;
      autoTimer = window.setInterval(() => render(activeIndex + 1), autoInterval);
    };

    const restartAutoPlay = () => {
      stopAutoPlay();
      startAutoPlay();
    };

    indicators.forEach((indicator) => {
      indicator.addEventListener('click', () => {
        render(Number(indicator.dataset.carouselTarget));
        restartAutoPlay();
      });
    });

    // 悬停范围覆盖整个左侧视觉容器（含 SINCE 2000 标识与底部文字），移出后重新计时。
    const hoverArea = carousel.closest('.overview__visual') || carousel;
    hoverArea.addEventListener('mouseenter', () => {
      hoverPaused = true;
      stopAutoPlay();
    });
    hoverArea.addEventListener('mouseleave', () => {
      hoverPaused = false;
      startAutoPlay();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopAutoPlay();
      } else {
        startAutoPlay();
      }
    });

    if (reduceMotionQuery.addEventListener) {
      reduceMotionQuery.addEventListener('change', restartAutoPlay);
    } else if (reduceMotionQuery.addListener) {
      reduceMotionQuery.addListener(restartAutoPlay);
    }

    render(activeIndex);
    startAutoPlay();
  }

  /* ==========================================================================
     03. 固定导航、滚动进度与返回顶部
     ========================================================================== */
  const headerState = {
    header: null,
    progressBar: null,
    backToTop: null,
    lastFrameKey: ''
  };

  function updateScrollChrome() {
    const { header, progressBar, backToTop } = headerState;
    if (!header) return;

    const scrollY = window.scrollY || window.pageYOffset;
    const progressHeight = document.documentElement.scrollHeight - window.innerHeight;
    const frameKey = `${scrollY}|${progressHeight}|${window.innerHeight}`;
    if (frameKey === headerState.lastFrameKey) return;
    headerState.lastFrameKey = frameKey;

    // 顶部初始为半透明，离开首屏阈值后切换深色磨砂玻璃。
    header.classList.toggle('is-scrolled', scrollY > 24);

    // 顶部阅读进度条。
    const progress = progressHeight > 0 ? Math.min(1, scrollY / progressHeight) : 0;
    if (progressBar) {
      progressBar.style.width = `${(progress * 100).toFixed(3)}%`;
    }

    if (backToTop) {
      backToTop.classList.toggle('is-visible', scrollY > 680);
    }
  }

  /* ==========================================================================
     04. 导航高亮（Scroll Spy）
     ========================================================================== */
  const navState = {
    links: [],
    sections: [],
    currentId: ''
  };

  function collectNavSections() {
    navState.links = $$('[data-nav-link]');
    const ids = navState.links
      .map((link) => (link.getAttribute('href') || '').replace('#', ''))
      .filter(Boolean);

    navState.sections = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean);
  }

  function updateActiveNav() {
    if (!navState.sections.length) return;

    const viewportAnchor = window.scrollY + window.innerHeight * 0.34;
    let currentId = '';

    navState.sections.forEach((section) => {
      if (section.offsetTop <= viewportAnchor) {
        currentId = section.id;
      }
    });

    if (currentId === navState.currentId) return;
    navState.currentId = currentId;

    navState.links.forEach((link) => {
      const isActive = link.getAttribute('href') === `#${currentId}`;
      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  /* ==========================================================================
     05. 移动端导航
     ========================================================================== */
  function initMobileMenu() {
    const toggle = $('[data-menu-toggle]');
    const menu = $('[data-mobile-menu]');
    if (!toggle || !menu) return;

    const mobileLinks = $$('[data-mobile-link]', menu);
    let lastFocusedElement = null;

    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-hidden', String(!open));
      menu.classList.toggle('is-open', open);
      document.body.classList.toggle('menu-open', open);

      const label = $('.sr-only', toggle);
      if (label) label.textContent = open ? '关闭导航菜单' : '打开导航菜单';

      if (open) {
        lastFocusedElement = document.activeElement;
        raf(() => {
          const firstLink = $('a', menu);
          if (firstLink) firstLink.focus({ preventScroll: true });
        });
      } else if (lastFocusedElement) {
        // 仅在用户主动关闭时把焦点交还触发按钮。
        lastFocusedElement.focus({ preventScroll: true });
      }
    };

    toggle.addEventListener('click', () => setOpen(!isOpen()));

    mobileLinks.forEach((link) => {
      link.addEventListener('click', () => setOpen(false));
    });

    const menuCta = $('.mobile-menu__cta', menu);
    if (menuCta) {
      menuCta.addEventListener('click', () => setOpen(false));
    }

    document.addEventListener('keydown', (event) => {
      if (!isOpen()) return;

      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }

      // 焦点陷阱：保证键盘用户始终停留在展开的移动菜单内部。
      if (event.key === 'Tab') {
        const focusable = $$('a[href], button:not([disabled])', menu).filter(
          (element) => element.offsetParent !== null
        );
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    // 窗口回到桌面宽度时自动收起菜单，避免状态残留。
    const closeOnDesktop = (event) => {
      if (event.matches && isOpen()) {
        toggle.setAttribute('aria-expanded', 'false');
        menu.setAttribute('aria-hidden', 'true');
        menu.classList.remove('is-open');
        document.body.classList.remove('menu-open');
        toggle.focus({ preventScroll: true });
      }
    };

    if (desktopLayoutQuery.addEventListener) {
      desktopLayoutQuery.addEventListener('change', closeOnDesktop);
    } else {
      desktopLayoutQuery.addListener(closeOnDesktop);
    }
  }

  /* ==========================================================================
     06. 通用滚动入场动画（IntersectionObserver）
     支持 fadeIn / slideUp / scaleIn 三种模式，默认 slideUp：
     进入视口 15% 时触发，上移 30px 并淡入，700ms ease-out，仅播放一次。
     同一模块中的卡片通过 [data-reveal-stagger] 自动按 100ms 依次延迟。
     ========================================================================== */
  const REVEAL_MODES = new Set(['fadeIn', 'slideUp', 'scaleIn']);

  function initScrollReveal() {
    const elements = $$('[data-reveal]');
    if (!elements.length) return;

    // 没有显式模式时回落到默认 slideUp，保证通用函数可被后续模块直接复用。
    elements.forEach((element) => {
      if (!REVEAL_MODES.has(element.dataset.reveal)) {
        element.dataset.reveal = 'slideUp';
      }
    });

    // 同一卡片组按 DOM 顺序覆盖为 0 / 100 / 200 / 300ms……
    $$('[data-reveal-stagger]').forEach((group) => {
      const step = Math.max(0, Number(group.dataset.revealStagger) || 100);
      Array.from(group.children)
        .filter((child) => child.matches('[data-reveal]'))
        .forEach((card, index) => {
          card.dataset.delay = String(index * step);
        });
    });

    elements.forEach((element) => {
      const delay = Math.max(0, Number(element.dataset.delay || 0));
      element.style.setProperty('--reveal-delay', `${delay}ms`);
    });

    const releaseElement = (element) => {
      // 动画结束后释放合成层，并把过渡节奏交还给卡片自身的 400ms 悬浮规范。
      window.setTimeout(() => {
        element.style.willChange = 'auto';
        element.classList.add('reveal-settled');
      }, 1600);
    };

    const showElement = (element, observer) => {
      if (element.classList.contains('is-visible')) return;
      element.classList.add('is-visible');
      if (observer) observer.unobserve(element);
      releaseElement(element);
    };

    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      elements.forEach((element) => showElement(element));
      return;
    }

    // 元素可见面积达到 15% 即触发；不设置额外 rootMargin，避免提前入场。
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          showElement(entry.target, observer);
        });
      },
      {
        root: null,
        threshold: 0.15
      }
    );

    elements.forEach((element) => observer.observe(element));
  }

  /* ==========================================================================
     06.5 育人关键词球堆（参考 JIEJOE HOME idea 区）
     ----------------------------------------------------------------------------
     不再使用散点漂浮 / 鼠标视差；改为原生物理球堆：
     · 8 个核心关键词球与 24 个辅助关键词标签球在板块底部下落、碰撞、堆积；
     · 球体按实际渲染尺寸参与碰撞（基础尺寸 × 响应式 --pile-scale）；
     · 进入视口 10% 时只触发一次；
     · 正常模式：淡入后受重力下落并稳定，稳定后停止 rAF；
     · 页面向下滚动经过板块时给球堆向上冲量，让球体弹跳并重新落回堆中；
     · 页面向上滚动时不施加向上冲量，并取消球体上升速度；静止球堆不唤醒，保证“球不动”；
     · 纯装饰，不绑定点击或拖动；
     · 减少动态：直接同步算出静态球堆，不做下落或滚动弹跳；
     · 重力、阻尼、球堆宽度、滚动弹跳力度集中在 PILE_CONFIG 中。
     ========================================================================== */
  function initKeywordField() {
    const field = $('[data-keyword-field]');
    if (!field) return;

    const pit = $('[data-keyword-pit]', field);
    const orbs = $$('.keyword-orb', field);
    if (!pit || !orbs.length) return;

    const PILE_CONFIG = {
      gravity: 2200,
      restitution: 0.16,
      wallRestitution: 0.3,
      groundFriction: 0.86,
      airDrag: 0.999,
      floorOffset: 18,
      maxPileWidth: 1400,
      sidePadding: 20,
      settleSpeed: 8,
      settleFrames: 45,
      fixedStep: 1 / 120,
      maxSteps: 8,
      scrollBounce: 700,
      scrollJitter: 100,
      scrollCooldown: 90,
      scrollMaxSpeed: 1050,
      scrollMaxSide: 220
    };

    const balls = orbs.map((element) => {
      // 使用实际渲染尺寸（基础 size × 视口缩放），保证物理半径与视觉一致。
      const size = element.offsetWidth || 88;

      return {
        element,
        radius: size / 2,
        size,
        mass: (size / 2) * (size / 2),
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        isWord: element.classList.contains('keyword-orb--word')
      };
    });

    let started = false;
    let running = false;
    let frameId = 0;
    let lastTime = 0;
    let accumulator = 0;
    let settleFrames = 0;
    let lastScrollBounce = 0;
    let lastScrollY = window.scrollY;

    let width = pit.clientWidth || window.innerWidth;
    let height = pit.clientHeight || window.innerHeight;
    let pileLeft = 0;
    let pileRight = 0;
    let floor = 0;

    const syncBounds = () => {
      width = pit.clientWidth || window.innerWidth;
      height = pit.clientHeight || window.innerHeight;
      const pileWidth = Math.max(
        240,
        Math.min(width - PILE_CONFIG.sidePadding * 2, PILE_CONFIG.maxPileWidth)
      );
      pileLeft = (width - pileWidth) / 2;
      pileRight = pileLeft + pileWidth;
      floor = height - PILE_CONFIG.floorOffset;
    };

    const render = () => {
      balls.forEach((ball) => {
        ball.element.style.transform = `translate3d(${(ball.x - ball.radius).toFixed(1)}px, ${(ball.y - ball.radius).toFixed(1)}px, 0)`;
      });
    };

    const clampBall = (ball) => {
      ball.x = Math.max(pileLeft + ball.radius, Math.min(pileRight - ball.radius, ball.x));
      ball.y = Math.min(floor - ball.radius, ball.y);
    };

    const collide = () => {
      for (let iteration = 0; iteration < 3; iteration += 1) {
        for (let aIndex = 0; aIndex < balls.length; aIndex += 1) {
          for (let bIndex = aIndex + 1; bIndex < balls.length; bIndex += 1) {
            const a = balls[aIndex];
            const b = balls[bIndex];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            const minDistance = a.radius + b.radius;
            let distanceSq = dx * dx + dy * dy;

            if (distanceSq >= minDistance * minDistance) continue;

            let distance = Math.sqrt(distanceSq);
            if (distance < 0.001) {
              dx = 0.01;
              dy = 0;
              distance = 0.01;
              distanceSq = 0.0001;
            }

            const nx = dx / distance;
            const ny = dy / distance;
            const overlap = minDistance - distance;
            const inverseA = 1 / a.mass;
            const inverseB = 1 / b.mass;
            const inverseTotal = inverseA + inverseB;

            // 位置分离，避免球体重叠累积。
            a.x -= nx * overlap * (inverseA / inverseTotal) * 0.9;
            a.y -= ny * overlap * (inverseA / inverseTotal) * 0.9;
            b.x += nx * overlap * (inverseB / inverseTotal) * 0.9;
            b.y += ny * overlap * (inverseB / inverseTotal) * 0.9;

            // 沿碰撞法线的冲量，让球堆自然稳定下来。
            const relativeX = b.vx - a.vx;
            const relativeY = b.vy - a.vy;
            const normalVelocity = relativeX * nx + relativeY * ny;
            if (normalVelocity >= 0) continue;

            const impulse =
              (-(1 + PILE_CONFIG.restitution) * normalVelocity) / inverseTotal;
            a.vx -= impulse * nx * inverseA;
            a.vy -= impulse * ny * inverseA;
            b.vx += impulse * nx * inverseB;
            b.vy += impulse * ny * inverseB;
          }
        }
      }
    };

    const simulate = (dt) => {
      balls.forEach((ball) => {
        ball.vy += PILE_CONFIG.gravity * dt;
        ball.vx *= PILE_CONFIG.airDrag;
        ball.vy *= PILE_CONFIG.airDrag;
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        if (ball.x - ball.radius < pileLeft) {
          ball.x = pileLeft + ball.radius;
          if (ball.vx < 0) ball.vx *= -PILE_CONFIG.wallRestitution;
        } else if (ball.x + ball.radius > pileRight) {
          ball.x = pileRight - ball.radius;
          if (ball.vx > 0) ball.vx *= -PILE_CONFIG.wallRestitution;
        }

        if (ball.y + ball.radius > floor) {
          ball.y = floor - ball.radius;
          if (ball.vy > 0) ball.vy *= -PILE_CONFIG.restitution;
          ball.vx *= PILE_CONFIG.groundFriction;
        }
      });

      collide();
      balls.forEach(clampBall);
    };

    const seedPile = () => {
      syncBounds();
      const wordBalls = balls.filter((ball) => ball.isWord);
      const bubbleBalls = balls.filter((ball) => !ball.isWord);
      const wordSpan = pileRight - pileLeft;

      wordBalls.forEach((ball, index) => {
        const slot = (index + 0.5) / wordBalls.length;
        ball.x = pileLeft + ball.radius + slot * (wordSpan - ball.radius * 2);
        ball.y = -ball.radius - Math.random() * height * 0.75;
        ball.vx = (Math.random() - 0.5) * 36;
        ball.vy = 0;
      });

      bubbleBalls.forEach((ball) => {
        ball.x =
          pileLeft +
          ball.radius +
          Math.random() * Math.max(1, wordSpan - ball.radius * 2);
        ball.y = -ball.radius - Math.random() * height * 1.05;
        ball.vx = (Math.random() - 0.5) * 60;
        ball.vy = 0;
      });

      balls.forEach(clampBall);
      render();
    };

    const settleStaticPile = (reseed = true) => {
      // 减少动态效果时直接同步推进物理，得到静态球堆，不展示下落过程。
      if (reseed) seedPile();
      for (let step = 0; step < 520; step += 1) {
        simulate(1 / 120);
      }
      render();
    };

    const maxSpeed = () =>
      balls.reduce((max, ball) => Math.max(max, Math.hypot(ball.vx, ball.vy)), 0);

    const frame = (now) => {
      frameId = 0;
      if (!running) return;

      if (!lastTime) lastTime = now;
      const delta = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      accumulator += delta;

      let steps = 0;
      while (accumulator >= PILE_CONFIG.fixedStep && steps < PILE_CONFIG.maxSteps) {
        simulate(PILE_CONFIG.fixedStep);
        accumulator -= PILE_CONFIG.fixedStep;
        steps += 1;
      }
      render();

      if (maxSpeed() < PILE_CONFIG.settleSpeed) {
        settleFrames += 1;
      } else {
        settleFrames = 0;
      }

      if (settleFrames > PILE_CONFIG.settleFrames) {
        running = false;
        return;
      }

      frameId = raf(frame);
    };

    const wake = () => {
      if (!started || prefersReducedMotion()) return;
      if (running) return;
      running = true;
      lastTime = 0;
      accumulator = 0;
      settleFrames = 0;
      frameId = raf(frame);
    };

    const start = () => {
      if (started) return;
      started = true;
      field.classList.add('is-active');

      if (prefersReducedMotion()) {
        settleStaticPile();
        return;
      }

      seedPile();
      running = true;
      lastTime = 0;
      accumulator = 0;
      settleFrames = 0;
      frameId = raf(frame);
    };

    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      start();
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          start();
          observer.disconnect();
        },
        { threshold: 0.1 }
      );

      observer.observe(field);
    }

    window.addEventListener(
      'resize',
      () => {
        if (!started) return;
        syncBounds();
        balls.forEach(clampBall);
        render();
        wake();
      },
      { passive: true }
    );

    // 与参考站一致的方向逻辑：
    // scrollY 增大（页面向下滚动）时施加负 y 冲量，球向上弹起；
    // scrollY 减小（页面向上滚动）时不再向上弹，只取消上升速度并交由重力压回。
    window.addEventListener(
      'scroll',
      () => {
        const currentScrollY = window.scrollY;
        const scrollDelta = currentScrollY - lastScrollY;
        lastScrollY = currentScrollY;

        if (!started || prefersReducedMotion() || scrollDelta === 0) return;

        const rect = field.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;

        // 向上滚：不弹跳，只取消明显上升的速度，让它们被重力压回堆中。
        // 静止球堆的微小接触速度不处理、也不唤醒，页面向上滚动时保持不动。
        if (scrollDelta < 0) {
          balls.forEach((ball) => {
            if (ball.vy < -24) ball.vy = 0;
          });
          return;
        }

        // 向下滚：给球堆向上冲量，触发参考站那种弹跳回落后再堆叠的效果。
        const now = performance.now();
        if (now - lastScrollBounce < PILE_CONFIG.scrollCooldown) return;
        lastScrollBounce = now;

        balls.forEach((ball) => {
          const lift = PILE_CONFIG.scrollBounce * (0.82 + Math.random() * 0.4);
          ball.vy = Math.max(ball.vy - lift, -PILE_CONFIG.scrollMaxSpeed);
          ball.vx += (Math.random() - 0.5) * PILE_CONFIG.scrollJitter;
          ball.vx = Math.max(
            -PILE_CONFIG.scrollMaxSide,
            Math.min(PILE_CONFIG.scrollMaxSide, ball.vx)
          );
        });

        wake();
      },
      { passive: true }
    );

    if (reduceMotionQuery.addEventListener) {
      reduceMotionQuery.addEventListener('change', (event) => {
        if (!event.matches || !started) return;
        running = false;
        if (frameId) {
          window.cancelAnimationFrame(frameId);
          frameId = 0;
        }
        settleStaticPile(false);
      });
    } else if (reduceMotionQuery.addListener) {
      reduceMotionQuery.addListener((event) => {
        if (!event.matches || !started) return;
        running = false;
        if (frameId) {
          window.cancelAnimationFrame(frameId);
          frameId = 0;
        }
        settleStaticPile(false);
      });
    }
  }

  /* ==========================================================================
     07. 数据数字滚动计数
     从 0 平滑滚动到 data-count 目标值；时长由 data-duration 控制（默认 1200ms）。
     ========================================================================== */
  function initCounters() {
    const counters = $$('[data-count]');
    if (!counters.length) return;

    const setFinalValue = (element) => {
      const target = Number(element.dataset.count || 0);
      element.textContent = formatMetric(target);
    };

    const startCounting = (element) => {
      if (element.dataset.counting === 'true' || element.dataset.counted === 'true') {
        return;
      }

      const target = Number(element.dataset.count || 0);
      const duration = Math.max(0, Number(element.dataset.duration || 1200));

      if (prefersReducedMotion() || duration === 0) {
        setFinalValue(element);
        element.dataset.counted = 'true';
        return;
      }

      element.dataset.counting = 'true';
      let startTime = null;

      const finish = () => {
        setFinalValue(element);
        element.dataset.counting = 'false';
        element.dataset.counted = 'true';
      };

      const tick = (timestamp) => {
        if (startTime === null) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(1, elapsed / duration);
        const current = target * easeOutCubic(progress);

        element.textContent = formatMetric(current);

        if (progress < 1) {
          raf(tick);
        } else {
          finish();
        }
      };

      // 先落回 0，再开始增长，让动画起止都清晰可见。
      element.textContent = '0';
      raf(tick);

      // 后台标签页可能暂停 rAF；超时后直接落到最终值，确保数字不会停在中间态。
      window.setTimeout(() => {
        if (element.dataset.counting === 'true') finish();
      }, duration + 140);
    };

    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      counters.forEach(setFinalValue);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          startCounting(entry.target);
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.55,
        rootMargin: '0px 0px -4% 0px'
      }
    );

    counters.forEach((counter) => observer.observe(counter));
  }

  /* ==========================================================================
     08. Hero 视差滚动
     只对带 data-parallax 的背景层做轻量位移，不影响内容层阅读。
     移动端、减少动态效果时自动关闭。
     ========================================================================== */
  const parallaxState = {
    layer: null,
    speed: 0,
    lastOffset: null
  };

  function initParallax() {
    const layer = $('[data-parallax]');
    if (!layer) return;

    parallaxState.layer = layer;
    parallaxState.speed = Number(layer.dataset.parallax || 0.14);
  }

  function updateParallax() {
    const { layer, speed } = parallaxState;
    if (!layer) return;

    const disabled = prefersReducedMotion() || !desktopLayoutQuery.matches;
    if (disabled) {
      if (parallaxState.lastOffset !== 0) {
        layer.style.transform = '';
        parallaxState.lastOffset = 0;
      }
      return;
    }

    const scrollY = window.scrollY || window.pageYOffset;
    const hero = layer.closest('.hero');
    const heroHeight = hero ? hero.offsetHeight : window.innerHeight;

    // 超出 Hero 区域后不再计算，减少无意义的样式写入。
    if (scrollY > heroHeight + 100) return;

    const offset = Math.min(scrollY, heroHeight) * speed;
    if (
      parallaxState.lastOffset !== null &&
      Math.abs(offset - parallaxState.lastOffset) < 0.35
    ) {
      return;
    }

    // 保留背景层的轻微放大，避免位移时露出边缘。
    layer.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0) scale(1.035)`;
    parallaxState.lastOffset = offset;
  }

  /* ==========================================================================
     08.1 Hero 氛围与联动（鼠标视差 / 滚动模糊与淡出）
     鼠标偏移系数：背景 0.02、光晕 0.04、文字 0.06；
     最大视觉位移控制在 18px 内，保持克制。所有更新由 rAF 合并。
     ========================================================================== */
  const heroMotionState = {
    hero: null,
    bgMouse: null,
    glows: null,
    content: null,
    height: 0,
    lastProgress: -1,
    pointerFrame: 0,
    pointerX: 0,
    pointerY: 0
  };

  const HERO_POINTER_COEFFICIENTS = {
    background: 0.02,
    glow: 0.04,
    text: 0.06
  };
  const HERO_POINTER_MAX_TEXT_SHIFT = 18;

  function syncHeroHeight() {
    if (!heroMotionState.hero) return;
    heroMotionState.height = heroMotionState.hero.offsetHeight || window.innerHeight;
  }

  function resetHeroPointerTransforms() {
    // 取消尚未执行的指针帧，避免移出后又被最后一次坐标覆盖。
    if (heroMotionState.pointerFrame) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(heroMotionState.pointerFrame);
      } else {
        window.clearTimeout(heroMotionState.pointerFrame);
      }
      heroMotionState.pointerFrame = 0;
    }

    [heroMotionState.bgMouse, heroMotionState.glows, heroMotionState.content]
      .filter(Boolean)
      .forEach((element) => {
        element.style.transform = 'translate3d(0, 0, 0)';
      });
  }

  function updateHeroScrollEffects() {
    const { hero } = heroMotionState;
    if (!hero) return;

    if (prefersReducedMotion()) {
      hero.style.setProperty('--hero-scroll-blur', '0px');
      hero.style.setProperty('--hero-scroll-darken', '0');
      hero.style.setProperty('--hero-scroll-fade', '0');
      heroMotionState.lastProgress = 0;
      return;
    }

    const height = heroMotionState.height || window.innerHeight;
    const scrollY = window.scrollY || window.pageYOffset;
    const rawProgress = height > 0 ? scrollY / height : 0;
    const progress = Math.min(1, Math.max(0, rawProgress));

    if (Math.abs(progress - heroMotionState.lastProgress) < 0.002) return;
    heroMotionState.lastProgress = progress;

    // 最大模糊 6px（移动端 4px），避免过度处理与性能损耗。
    const maxBlur = window.innerWidth <= 720 ? 4 : 6;
    const blur = progress * maxBlur;
    const darken = progress * 0.72;
    const fade = Math.min(1, progress * 1.06);

    hero.style.setProperty('--hero-scroll-blur', `${blur.toFixed(2)}px`);
    hero.style.setProperty('--hero-scroll-darken', darken.toFixed(3));
    hero.style.setProperty('--hero-scroll-fade', fade.toFixed(3));
  }

  function initHeroEffects() {
    const hero = $('.hero');
    if (!hero) return;

    heroMotionState.hero = hero;
    heroMotionState.bgMouse = $('.hero__bg-mouse', hero);
    heroMotionState.glows = $('.hero__glows', hero);
    heroMotionState.content = $('.hero__content', hero);
    syncHeroHeight();

    scrollTasks.push(updateHeroScrollEffects);
    updateHeroScrollEffects();

    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(() => {
        syncHeroHeight();
        heroMotionState.lastProgress = -1;
        updateHeroScrollEffects();
      });
      resizeObserver.observe(hero);
    } else {
      window.addEventListener(
        'resize',
        () => {
          syncHeroHeight();
          heroMotionState.lastProgress = -1;
          updateHeroScrollEffects();
        },
        { passive: true }
      );
    }

    window.addEventListener(
      'load',
      () => {
        syncHeroHeight();
      },
      { once: true }
    );

    // 鼠标视差仅在精细指针设备且未开启减少动态效果时启用。
    if (!desktopPointerQuery.matches || prefersReducedMotion()) return;

    const schedulePointerFrame = () => {
      if (heroMotionState.pointerFrame) return;
      heroMotionState.pointerFrame = raf(() => {
        heroMotionState.pointerFrame = 0;

        if (prefersReducedMotion() || !desktopPointerQuery.matches) {
          resetHeroPointerTransforms();
          return;
        }

        const rect = hero.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const normalizedX = ((heroMotionState.pointerX - rect.left) / rect.width - 0.5) * 2;
        const normalizedY = ((heroMotionState.pointerY - rect.top) / rect.height - 0.5) * 2;
        const baseAmplitude = HERO_POINTER_MAX_TEXT_SHIFT / HERO_POINTER_COEFFICIENTS.text;

        const writeShift = (element, coefficient) => {
          if (!element) return;
          const x = normalizedX * baseAmplitude * coefficient;
          const y = normalizedY * baseAmplitude * coefficient * 0.52;
          element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        };

        writeShift(heroMotionState.bgMouse, HERO_POINTER_COEFFICIENTS.background);
        writeShift(heroMotionState.glows, HERO_POINTER_COEFFICIENTS.glow);
        writeShift(heroMotionState.content, HERO_POINTER_COEFFICIENTS.text);
      });
    };

    hero.addEventListener(
      'pointermove',
      (event) => {
        heroMotionState.pointerX = event.clientX;
        heroMotionState.pointerY = event.clientY;
        schedulePointerFrame();
      },
      { passive: true }
    );

    hero.addEventListener('pointerleave', resetHeroPointerTransforms, { passive: true });
    window.addEventListener('blur', resetHeroPointerTransforms, { passive: true });

    if (desktopPointerQuery.addEventListener) {
      desktopPointerQuery.addEventListener('change', (event) => {
        if (!event.matches) resetHeroPointerTransforms();
      });
    }
  }

  /* ==========================================================================
     09. 光标微光与卡片光晕
     纯视觉增强，不影响任何点击 / 表单行为。
     ========================================================================== */
  function initCursorGlow() {
    const glow = $('.cursor-glow');
    if (!glow || !desktopPointerQuery.matches) return;

    let pendingX = 0;
    let pendingY = 0;
    let ticking = false;

    const paint = () => {
      glow.style.setProperty('--cursor-x', `${pendingX}px`);
      glow.style.setProperty('--cursor-y', `${pendingY}px`);
      ticking = false;
    };

    document.addEventListener(
      'pointermove',
      (event) => {
        pendingX = event.clientX;
        pendingY = event.clientY;
        glow.classList.add('is-active');
        if (!ticking) {
          ticking = true;
          raf(paint);
        }
      },
      { passive: true }
    );

    document.addEventListener('pointerleave', () => {
      glow.classList.remove('is-active');
    });
  }

  function initCardGlow() {
    const cards = $$('.feature-card');
    if (!cards.length || !desktopPointerQuery.matches || prefersReducedMotion()) return;

    cards.forEach((card) => {
      card.addEventListener(
        'pointermove',
        (event) => {
          const rect = card.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 100;
          const y = ((event.clientY - rect.top) / rect.height) * 100;
          card.style.setProperty('--card-x', `${x.toFixed(2)}%`);
          card.style.setProperty('--card-y', `${y.toFixed(2)}%`);
        },
        { passive: true }
      );
    });
  }

  /* ==========================================================================
     10. 初始化调度
     统一用一个 rAF 驱动的滚动回调处理多处 DOM 更新，避免多个 scroll 监听互相竞争。
     ========================================================================== */
  function init() {
    initPageLoader();
    initImageSlots();
    initOverviewCarousel();
    initMobileMenu();
    initScrollReveal();
    initKeywordField();
    initCounters();
    initParallax();
    initHeroEffects();
    initCursorGlow();
    initCardGlow();

    headerState.header = $('[data-header]');
    headerState.progressBar = $('[data-scroll-progress]');
    headerState.backToTop = $('[data-back-to-top]');

    collectNavSections();

    let scrollTicking = false;

    const onScrollFrame = () => {
      updateScrollChrome();
      updateActiveNav();
      updateParallax();
      scrollTasks.forEach((task) => task());
      scrollTicking = false;
    };

    const requestScrollFrame = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      raf(onScrollFrame);
    };

    window.addEventListener('scroll', requestScrollFrame, { passive: true });
    window.addEventListener('resize', requestScrollFrame, { passive: true });
    window.addEventListener('load', requestScrollFrame, { once: true });

    // 首帧同步一次状态（含刷新后浏览器恢复滚动位置的情况）。
    updateScrollChrome();
    updateActiveNav();
    updateParallax();

    // 通知 HTML 中的兜底计时器：初始化已完成，无需强制展示静态内容。
    root.classList.add('site-ready');
    root.classList.remove('reveal-fallback');

    // 当系统动态偏好变化时，让入场内容 / 计数保持可读。
    const handleMotionChange = (event) => {
      if (event.matches) {
        $$('[data-reveal]').forEach((element) => element.classList.add('is-visible'));
        $$('[data-count]').forEach((element) => {
          const target = Number(element.dataset.count || 0);
          element.textContent = formatMetric(target);
        });

        const layer = parallaxState.layer;
        if (layer) layer.style.transform = '';

        const hero = heroMotionState.hero;
        if (hero) {
          hero.style.setProperty('--hero-scroll-blur', '0px');
          hero.style.setProperty('--hero-scroll-darken', '0');
          hero.style.setProperty('--hero-scroll-fade', '0');
        }
        resetHeroPointerTransforms();
      }
    };

    if (reduceMotionQuery.addEventListener) {
      reduceMotionQuery.addEventListener('change', handleMotionChange);
    } else if (reduceMotionQuery.addListener) {
      reduceMotionQuery.addListener(handleMotionChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
