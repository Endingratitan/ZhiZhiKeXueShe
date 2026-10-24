import { createArticleData } from '../../assets/js/csr/list/core.js';
import { articleCard } from '../../assets/js/csr/list/card.js';
import { createLatestList } from '../../assets/js/csr/list/show/latest.js';

const data = createArticleData({ rootUrl: '../../' });

createLatestList({
    data,
    column: '社团动态',
    source: 'important',
    mount: '#cuptReviewList',
    limit: 3,
    skeletons: 3,
    card: articleCard({
        hrefBase: '../news-ar/article.html#',
        showAuthors: true,
        linkText: '查看回顾 →'
    })
});
