/* 首页 Hero：最早那版 — cover 保持，下滑到后段内容淡出/缩小，然后自然进入 About。
   不使用任何额外 layer，也不自动跳转。 */
(function () {
    'use strict';
    var hero = document.querySelector('.hero');
    var stage = document.querySelector('.hero-stage');
    var spacer = document.querySelector('.hero-pin-space');
    if (!hero || !stage || !spacer) { return; }

    var ticking = false;

    function update() {
        ticking = false;
        var sticky = window.getComputedStyle(hero).position === 'sticky';
        if (!sticky) {
            hero.style.setProperty('--hero-exit', '0');
            return;
        }
        var hold = spacer.offsetHeight;
        if (!hold) { return; }
        var top = stage.getBoundingClientRect().top;
        var progress = Math.min(1, Math.max(0, -top / hold));
        var exit = Math.min(1, Math.max(0, (progress - 0.5) / 0.5));
        hero.style.setProperty('--hero-exit', exit.toFixed(3));
    }

    function schedule() {
        if (ticking) { return; }
        ticking = true;
        window.requestAnimationFrame(update);
    }

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    update();
})();
