import { createArticleData } from '../../assets/js/csr/list/core.js';
import { articleCard } from '../../assets/js/csr/list/card.js';
import { createAutoLoadList } from '../../assets/js/csr/list/show/auto-load.js';

const data = createArticleData({ rootUrl: '../../' });

createAutoLoadList({
    data,
    column: '社团动态',
    mount: '#newsList',
    importantMount: '#importantList',
    status: '#listStatus',
    count: '#listCount',
    pageSize: 6,
    showImportant: true,
    card: articleCard({
        hrefBase: '../news-ar/article.html#',
        showAuthors: true
    })
});
