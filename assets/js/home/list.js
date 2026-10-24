import { createArticleData } from '../csr/list/core.js';
import { articleCard } from '../csr/list/card.js';
import { createLatestList } from '../csr/list/show/latest.js';

const data = createArticleData({ rootUrl: './' });

createLatestList({
    data,
    column: '社团动态',
    mount: '#homeNewsList',
    limit: 3,
    skeletons: 3,
    card: articleCard({
        hrefBase: 'pages/news-ar/article.html#',
        showAuthors: true
    })
});
