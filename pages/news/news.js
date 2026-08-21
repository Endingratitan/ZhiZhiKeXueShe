/* ============================================================
   致知科学社 · 社团动态板块脚本
   功能：照片灯箱
   ============================================================ */
(function () {
    'use strict';

    /* ---------- 照片灯箱 ---------- */
    var galleryImgs = Array.prototype.slice.call(
        document.querySelectorAll('img[data-lightbox]')
    );
    var lbIndex = 0;

    if (galleryImgs.length) {
        var lb = document.createElement('div');
        lb.className = 'lightbox';
        lb.setAttribute('role', 'dialog');
        lb.setAttribute('aria-label', '照片查看器');
        lb.innerHTML =
            '<button class="lb-btn lb-close" type="button" aria-label="关闭">×</button>' +
            '<button class="lb-btn lb-prev" type="button" aria-label="上一张">‹</button>' +
            '<button class="lb-btn lb-next" type="button" aria-label="下一张">›</button>' +
            '<figure class="lb-figure">' +
            '<img class="lb-img" src="" alt="">' +
            '<figcaption class="lb-caption"></figcaption>' +
            '</figure>' +
            '<span class="lb-counter"></span>';
        document.body.appendChild(lb);

        var lbImg = lb.querySelector('.lb-img');
        var lbCaption = lb.querySelector('.lb-caption');
        var lbCounter = lb.querySelector('.lb-counter');

        function showLb(i) {
            lbIndex = (i + galleryImgs.length) % galleryImgs.length;
            var item = galleryImgs[lbIndex];
            lbImg.src = item.src;
            lbImg.alt = item.alt || '';
            lbCaption.textContent = item.getAttribute('data-caption') || '';
            lbCounter.textContent = (lbIndex + 1) + ' / ' + galleryImgs.length;
        }

        function openLb(i) {
            showLb(i);
            lb.classList.add('open');
            document.body.style.overflow = 'hidden';
        }

        function closeLb() {
            lb.classList.remove('open');
            document.body.style.overflow = '';
        }

        galleryImgs.forEach(function (img, idx) {
            img.addEventListener('click', function () { openLb(idx); });
        });

        lb.querySelector('.lb-close').addEventListener('click', closeLb);
        lb.querySelector('.lb-prev').addEventListener('click', function () {
            showLb(lbIndex - 1);
        });
        lb.querySelector('.lb-next').addEventListener('click', function () {
            showLb(lbIndex + 1);
        });
        lb.addEventListener('click', function (e) {
            if (e.target === lb) { closeLb(); }
        });
        document.addEventListener('keydown', function (e) {
            if (!lb.classList.contains('open')) { return; }
            if (e.key === 'Escape') { closeLb(); }
            if (e.key === 'ArrowLeft') { showLb(lbIndex - 1); }
            if (e.key === 'ArrowRight') { showLb(lbIndex + 1); }
        });
    }

})();
