import { initArticleList } from '../../assets/js/csr/article/list.js';

initArticleList({
    mount: '#newsList',
    importantMount: '#importantList',
    moreButton: '#listMore',
    status: '#listStatus',
    count: '#listCount',
    configUrl: '../../articles/art-idx.config',
    column: '社团动态',
    articleHref: '../news-ar/article.html#',
    pageSize: 9
});
